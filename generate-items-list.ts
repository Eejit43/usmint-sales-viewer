import { parse } from 'node-html-parser';

export const rootSalesDirectory = new URL('https://www.usmint.gov/about/production-sales-figures/cumulative-sales');

const itemsListFile = Bun.file('items-list.json');

// eslint-disable-next-line unicorn/prefer-top-level-await
(async () => {
    const year = process.argv[2];
    if (!year) return console.error('No year specified!');

    const processedRootSalesDirectory = parse(await (await fetch(rootSalesDirectory)).text());

    const selectElement = processedRootSalesDirectory.querySelector(`#${year}weeks`);
    if (!selectElement) return console.error(`Could not find data for year ${year}!`);

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

        const dataUrl = new URL(rootSalesDirectory.toString());
        dataUrl.searchParams.set('years', year);
        dataUrl.searchParams.set(`${year}weeks`, week);

        const processedData = parse(await (await fetch(dataUrl)).text()); // eslint-disable-line no-await-in-loop

        const dataTable = processedData.querySelector('table');

        if (!dataTable) return console.error('Could not find data table, stopping process (are you being rate limited?)');

        const hasExtraColumn = dataTable.querySelectorAll('thead th')[1].text === 'Program Name';
        if (hasExtraColumn) console.log('There is an extra "Program Name" column, the first will be ignored');

        const rows = dataTable.querySelectorAll('tbody tr');

        for (const [index, row] of rows.entries()) {
            const columns = [...new Set(row.querySelectorAll('td').map((column) => column.text.trim()))];

            if (columns.length > 5 && hasExtraColumn) columns.shift();

            if (columns.length !== 5) {
                console.error(`Unexpected unique column count for row ${index + 1}/${rows.length} (${columns.length}), skipping row`);

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

        await new Promise((resolve) => setTimeout(resolve, 250)); // eslint-disable-line no-await-in-loop
    }

    Bun.write('items-list.json', JSON.stringify(result, null, 2));
})();
