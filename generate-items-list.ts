import { parse } from 'node-html-parser';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const rootSalesUrl = new URL('https://www.usmint.gov/about/production-sales-figures/cumulative-sales');

const itemsListFile = Bun.file('items-list.json');

// eslint-disable-next-line unicorn/prefer-top-level-await
(async () => {
    const year = process.argv[2];
    if (!year) return console.error('No year specified!');

    const processedRootSalesDirectory = parse(await (await fetch(rootSalesUrl)).text());

    const selectElement = processedRootSalesDirectory.querySelector(`#${year}weeks`);
    if (!selectElement) return console.error(`Could not find data for year ${year}!`);

    const reportDirectory = join('saved-reports', year);

    if (!existsSync(reportDirectory)) mkdirSync(reportDirectory, { recursive: true });

    const result: Record<string, { itemId: string; programName: string; totalSold: number; latestSale: { year: string; month: string | null; week: string } }> = (await itemsListFile.exists())
        ? await itemsListFile.json()
        : {};

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

            const [programName, itemId, itemName, totalSold, latestSaleDate] = columns;

            result[itemName] = {
                itemId,
                programName: programName.replaceAll(/ {2,}/g, ' '),
                totalSold: Number.parseInt(totalSold.replaceAll(',', '')),
                latestSale: { year, month: latestSaleDate.match(/(\d{1,2})\//)?.[1] ?? null, week },
            };
        }
    }

    Bun.write('items-list.json', JSON.stringify(result, null, 4) + '\n');
})();
