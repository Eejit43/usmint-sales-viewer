import { parse } from 'node-html-parser';

export const rootSalesDirectory = new URL('https://www.usmint.gov/about/production-sales-figures/cumulative-sales');

// eslint-disable-next-line unicorn/prefer-top-level-await
(async () => {
    const currentYear = new Date().getFullYear();
    const startYear = 2015;

    const years = Array.from({ length: currentYear - startYear + 1 }).map((value, index) => (startYear + index).toString());

    const processedRootSalesDirectory = parse(await (await fetch(rootSalesDirectory)).text());

    const result: Record<string, { itemId: string; programName: string; totalSold: number; latestSale: { year: string; month: string } }> = {};

    for (const year of years) {
        const selectElement = processedRootSalesDirectory.querySelector(`#${year}weeks`);
        if (!selectElement) {
            console.error(`Could not find select element for year ${year}!`);

            continue;
        }

        const optionElements = selectElement.querySelectorAll('option');

        const weeks = optionElements.map((option) => option.getAttribute('value')).filter(Boolean) as string[];

        for (const week of weeks) {
            console.log(`Processing ${year} week ${week} (${weeks.indexOf(week) + 1}/${weeks.length})`);

            const dataUrl = new URL(rootSalesDirectory.toString());
            dataUrl.searchParams.set('years', year);
            dataUrl.searchParams.set(`${year}weeks`, week);

            const processedData = parse(await (await fetch(dataUrl)).text()); // eslint-disable-line no-await-in-loop

            const dataTableBody = processedData.querySelector('table tbody');

            if (!dataTableBody) {
                console.error(`Could not find data table body for ${year} week ${week}!`);

                continue;
            }

            const rows = dataTableBody.querySelectorAll('tr');

            for (const row of rows) {
                const columns = row.querySelectorAll('td');

                const itemName = columns[2].text.trim();
                const totalSold = Number.parseInt(columns[3].text.trim().replaceAll(',', ''));

                if (result[itemName] && result[itemName].totalSold >= totalSold) continue;

                result[itemName] = {
                    itemId: columns[1].text.trim(),
                    programName: columns[0].text.trim(),
                    totalSold,
                    latestSale: { year, month: columns[4].text.trim().match(/(\d{1,2})\//)?.[1] ?? 'UNKNOWN' },
                };
            }

            await new Promise((resolve) => setTimeout(resolve, 250)); // eslint-disable-line no-await-in-loop
        }
    }

    Bun.write('items-list.json', JSON.stringify(result, null, 2));
})();
