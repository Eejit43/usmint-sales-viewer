import chalk from 'chalk';
import { parse } from 'node-html-parser';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type ItemsList = Record<string, { itemId: string; programName: string; totalSold: number; firstSeen: { year: number; week: number }; latestSaleData: { year: number; week: number } }>;

const rootSalesUrl = new URL('https://www.usmint.gov/about/production-sales-figures/cumulative-sales');

const listFile = join('lists', 'cumulative-sales.json');

await generateItemsList(process.argv[2] ? Number.parseInt(process.argv[2]) : 'all');

/**
 * Generates an item list for a given year, or all years.
 * @param year The year to fetch data for, or "all".
 */
async function generateItemsList(year: number | 'all') {
    const reportDirectory = join('saved-reports', 'cumulative-sales', year.toString());

    if (year === 'all') {
        if (existsSync(listFile)) rmSync(listFile);

        const currentYear = new Date().getFullYear();
        const startYear = 2015;

        const years = Array.from({ length: currentYear - startYear + 1 }).map((value, index) => startYear + index);

        for (const year of years) await generateItemsList(year);

        return;
    }

    const processedRootSalesDirectory = parse(await (await fetch(rootSalesUrl)).text());

    const selectElement = processedRootSalesDirectory.querySelector(`#${year}weeks`);
    if (!selectElement) return console.error(`Could not find data for year ${year}!`);

    if (!existsSync(reportDirectory)) mkdirSync(reportDirectory, { recursive: true });

    const itemsListFile = Bun.file(listFile);

    const result: ItemsList = (await itemsListFile.exists()) ? await itemsListFile.json() : {};

    const optionElements = selectElement.querySelectorAll('option');

    const weeks = optionElements
        .map((option) => [Number.parseInt(option.getAttribute('value')!), option.textContent.trim()] as [number, string])
        .filter(([week]) => week)
        .reverse();

    for (const [index, [week, weekName]] of weeks.entries()) {
        console.log(chalk.blue(`Processing week of ${chalk.yellow(weekName)} (${chalk.gray(week)}) (${chalk.gray(`${index + 1}/${weeks.length}`)})`));

        const savedReportFile = Bun.file(join(reportDirectory, `${week}.html`));

        let dataTable;
        if (await savedReportFile.exists()) {
            console.log(chalk.green('   Using saved report file'));
            dataTable = parse(await savedReportFile.text());
        } else {
            const dataUrl = new URL(rootSalesUrl.toString());
            dataUrl.searchParams.set('years', year.toString());
            dataUrl.searchParams.set(`${year}weeks`, week.toString());

            const processedData = parse(await (await fetch(dataUrl)).text());

            dataTable = processedData.querySelector('table');

            if (!dataTable) return console.error('   Could not find data table, stopping process (are you being rate limited?)');

            await Bun.write(savedReportFile, dataTable.toString());

            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        const headers = dataTable.querySelectorAll('thead th');

        const hasExtraNameColumn = headers[1].textContent === 'Program Name';
        if (hasExtraNameColumn) console.log(chalk.yellow('   There is an extra "Program Name" column, the first will be ignored'));

        let extraColumnsAmount = headers.length - 5;
        if (hasExtraNameColumn) extraColumnsAmount--;

        if (extraColumnsAmount > 0)
            console.log(chalk.yellow(`   There ${extraColumnsAmount === 1 ? `is ${extraColumnsAmount} extra column, it` : `are ${extraColumnsAmount} extra columns, they`} will be ignored`));

        const rows = dataTable.querySelectorAll('tbody tr');

        for (const [index, row] of rows.entries()) {
            let columns = row.querySelectorAll('td').map((column) => column.textContent.trim());

            if (hasExtraNameColumn) columns.shift();

            columns = columns.slice(0, 5);

            if (columns.length !== 5) {
                console.log(chalk.yellow(`   Unexpected column count for row ${index + 1}/${rows.length} (${columns.length}), skipping row`));

                continue;
            }

            const [programName, itemId, itemName, totalSold] = columns;

            const itemNameParsed = itemName.replaceAll(/ {2,}/g, ' ');
            const totalSoldParsed = Number.parseInt(totalSold.replaceAll(',', ''));
            const latestSaleData = { year, week };

            if (itemNameParsed in result) {
                result[itemNameParsed].totalSold = totalSoldParsed;
                result[itemNameParsed].latestSaleData = latestSaleData;
            } else result[itemNameParsed] = { itemId, programName, totalSold: totalSoldParsed, firstSeen: latestSaleData, latestSaleData };
        }
    }

    return await Bun.write(listFile, JSON.stringify(result, null, 4) + '\n');
}
