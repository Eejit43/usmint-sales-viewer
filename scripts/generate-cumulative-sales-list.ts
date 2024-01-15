import { parse } from 'node-html-parser';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const rootSalesUrl = new URL('https://www.usmint.gov/about/production-sales-figures/cumulative-sales');

await generateItemsList(process.argv[2] || 'all');

/**
 * Generates an item list for a given year, or all years.
 * @param year The year to fetch data for, or "all".
 */
async function generateItemsList(year: string) {
    const listFile = join('lists', 'cumulative-sales.json');
    const reportDirectory = join('saved-reports', 'cumulative-sales', year);

    if (year === 'all') {
        if (existsSync(listFile)) rmSync(listFile);

        const currentYear = new Date().getFullYear();
        const startYear = 2015;

        const years = Array.from({ length: currentYear - startYear + 1 }).map((value, index) => (startYear + index).toString());

        for (const year of years) await generateItemsList(year);

        return;
    }

    const processedRootSalesDirectory = parse(await (await fetch(rootSalesUrl)).text());

    const selectElement = processedRootSalesDirectory.querySelector(`#${year}weeks`);
    if (!selectElement) return console.error(`Could not find data for year ${year}!`);

    if (!existsSync(reportDirectory)) mkdirSync(reportDirectory, { recursive: true });

    const itemsListFile = Bun.file(listFile);

    const result: Record<string, { itemId: string; programName: string; totalSold: number; firstSeen: { year: string; week: string }; latestSale: { year: string; week: string } }> =
        (await itemsListFile.exists()) ? await itemsListFile.json() : {};

    const optionElements = selectElement.querySelectorAll('option');

    const weeks = optionElements
        .map((option) => [option.getAttribute('value')!, option.text.trim()])
        .filter(([week]) => week)
        .reverse();

    for (const [index, [week, weekName]] of weeks.entries()) {
        console.log(`Processing week of ${weekName} (${week}) (${index + 1}/${weeks.length})`);

        const savedReportFile = Bun.file(join(reportDirectory, `${week}.html`));

        let dataTable;
        if (await savedReportFile.exists()) {
            console.log('   Using saved report file');
            dataTable = parse(await savedReportFile.text());
        } else {
            const dataUrl = new URL(rootSalesUrl.toString());
            dataUrl.searchParams.set('years', year);
            dataUrl.searchParams.set(`${year}weeks`, week);

            const processedData = parse(await (await fetch(dataUrl)).text());

            dataTable = processedData.querySelector('table');

            if (!dataTable) return console.error('Could not find data table, stopping process (are you being rate limited?)');

            await Bun.write(savedReportFile, dataTable.toString());

            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        const headers = dataTable.querySelectorAll('thead th');

        const hasExtraNameColumn = headers[1].text === 'Program Name';
        if (hasExtraNameColumn) console.log('   There is an extra "Program Name" column, the first will be ignored');

        let extraColumnsAmount = headers.length - 5;
        if (hasExtraNameColumn) extraColumnsAmount--;

        if (extraColumnsAmount > 0) console.log(`   There ${extraColumnsAmount === 1 ? `is ${extraColumnsAmount} extra column, it` : `are ${extraColumnsAmount} extra columns, they`} will be ignored`);

        const rows = dataTable.querySelectorAll('tbody tr');

        for (const [index, row] of rows.entries()) {
            let columns = row.querySelectorAll('td').map((column) => column.text.trim());

            if (hasExtraNameColumn) columns.shift();

            columns = columns.slice(0, 5);

            if (columns.length !== 5) {
                console.error(`   Unexpected unique column count for row ${index + 1}/${rows.length} (${columns.length}), skipping row`);

                continue;
            }

            const [programName, itemId, itemName, totalSold] = columns;

            const itemNameParsed = itemName.replaceAll(/ {2,}/g, ' ');
            const totalSoldParsed = Number.parseInt(totalSold.replaceAll(',', ''));
            const latestSale = { year, week };

            if (itemNameParsed in result) {
                result[itemNameParsed].totalSold = totalSoldParsed;
                result[itemNameParsed].latestSale = latestSale;
            } else result[itemNameParsed] = { itemId, programName, totalSold: totalSoldParsed, firstSeen: latestSale, latestSale };
        }
    }

    return await Bun.write(listFile, JSON.stringify(result, null, 4) + '\n');
}
