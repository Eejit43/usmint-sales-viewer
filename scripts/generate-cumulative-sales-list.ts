import chalk from 'chalk';
import path from 'node:path';

export type ItemsList = Record<string, { name: string; program: string; sales: number; firstSeen: string; latestData: string }>;

const tokenResponse = await fetch('https://www.usmint.gov/libs/granite/csrf/token.json');

const cookies = tokenResponse.headers.getSetCookie();

const htmlContent = await (
    await fetch('https://www.usmint.gov/about/production-sales-figures/cumulative-sales', { headers: { cookie: cookies } })
).text();

const yearData = (await JSON.parse(
    /data-tabletype="cumulative" data-dropdownitems="(.*?)"/.exec(htmlContent)![1].replaceAll('&#34;', '"'),
)) as Record<string, Record<string, string[]>>;

const dates = Object.entries(yearData)
    .map(([year, monthData]) =>
        Object.entries(monthData).map(([monthName, dates]) =>
            dates.map((date) => ({ monthName, date: new Date(`${monthName} ${date}, ${year}`) })),
        ),
    )
    .flat(/* Depth is always 2 */ 2)
    .sort((a, b) => a.date.getTime() - b.date.getTime()); // eslint-disable-line unicorn/no-array-sort

const reportDirectory = path.join('saved-reports', 'cumulative-sales');

const result: ItemsList = {};

const knownDatesWithInvalidData: { dateString: string; date: Date }[] = [];
const ignoredDatesWithInvalidData: { marked: string; actual: string; date: Date }[] = [];

const cachedInvalidDatesLocation = path.join(reportDirectory, 'ignored-dates-with-invalid-data.json');
if (await Bun.file(cachedInvalidDatesLocation).exists()) {
    const cachedInvalidDates = (await Bun.file(cachedInvalidDatesLocation).json()) as string[];
    knownDatesWithInvalidData.push(...cachedInvalidDates.map((dateString) => ({ dateString, date: new Date(dateString) })));
}

for (const [index, { monthName, date }] of dates.entries()) {
    console.log(
        chalk.blue(
            `Processing week of ${chalk.yellow(
                date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
            )} (${chalk.gray(`${index + 1}/${dates.length}`)})`,
        ),
    );

    if (knownDatesWithInvalidData.some((knownDate) => knownDate.date.getTime() === date.getTime())) {
        console.log(chalk.gray('   Skipping known invalid data date'));
        continue;
    }

    const savedReportFile = Bun.file(
        path.join(reportDirectory, date.getFullYear().toString(), (date.getMonth() + 1).toString(), date.getDate().toString() + '.json'),
    );

    /* eslint-disable @typescript-eslint/naming-convention */
    type SalesData =
        | {
              'Program Name'?: string;
              ''?: string; // Program Name error value
              '﻿Program Name'?: string; // Program Name error value
              'Item': string;
              'Item Description': string;
              'Adj. Net Demand'?: string;
              'Adj Net Demand'?: string;
              'Date Sales Report is Valid': string;
          }[]
        | {
              'Program': string;
              'Program Item': string;
              'Product': string;
              'Sales to Date': string;
              'Sales Reporting Date': string;
          }[];
    /* eslint-enable @typescript-eslint/naming-convention */

    let salesData: SalesData;
    if (await savedReportFile.exists()) {
        console.log(chalk.green('   Using saved report file'));
        salesData = (await savedReportFile.json()) as SalesData;
    } else {
        const dataUrl = new URL(
            'https://www.usmint.gov/content/usmint/us/en/about/production-sales-figures/cumulative-sales/jcr:content/root/container/productionsalesdata.dropdowns.json',
        );
        dataUrl.searchParams.set('firstDropdown', date.getFullYear().toString());
        dataUrl.searchParams.set('secondDropdown', monthName);
        dataUrl.searchParams.set(
            'date',
            `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
        );

        try {
            salesData = (await (await fetch(dataUrl.toString(), { headers: { cookie: cookies } })).json()) as SalesData;
        } catch {
            console.log(chalk.red('   Failed to fetch data, skipping'));
            continue;
        }

        // Skip data if it is more than a day off from the marked date
        const reportDateString =
            'Date Sales Report is Valid' in salesData[0]
                ? salesData[0]['Date Sales Report is Valid']
                : 'Sales Reporting Date' in salesData[0]
                  ? salesData[0]['Sales Reporting Date']
                  : null;

        if (reportDateString) {
            const reportDate = new Date(reportDateString);
            const timeDifference = Math.abs(reportDate.getTime() - date.getTime());
            const dayDifference = Math.floor(timeDifference / (1000 * 3600 * 24));

            if (dayDifference > 1) {
                console.log(
                    chalk.red(
                        `   Report date (${reportDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}) differs from expected date by more than 1 day, skipping save`,
                    ),
                );
                ignoredDatesWithInvalidData.push({
                    marked: date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
                    actual: reportDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
                    date,
                });
                continue;
            }
        }

        await Bun.write(savedReportFile, JSON.stringify(salesData));
    }

    for (const item of salesData) {
        let id, name, sales, program;
        if ('Item Description' in item) {
            id = item.Item;
            name = item['Item Description'];
            sales = item['Adj. Net Demand'] ?? item['Adj Net Demand']!;
            program = item['Program Name'] ?? item[''] ?? item['﻿Program Name']!;
        } else {
            id = item['Program Item'];
            name = item.Product;
            sales = item['Sales to Date'];
            program = item.Program;
        }

        const parsedName = name
            .replaceAll('&amp;', '&')
            .replaceAll('–', '-')
            .replaceAll(/[^\w $&()+./Š-]/g, '')
            .replaceAll(/ {2,}/g, ' ');
        const parsedSales = Number.parseInt(sales.replaceAll('Ω', ''));
        const parsedProgram = program.replaceAll('&amp;', '&');
        const latestData = date.toLocaleDateString();

        if (!parsedName) continue;

        if (id in result) {
            result[id].sales = parsedSales;
            result[id].latestData = latestData;
        } else
            result[id] = {
                name: parsedName,
                program: parsedProgram,
                sales: parsedSales,
                firstSeen: latestData,
                latestData,
            };
    }
}

const listFile = path.join('lists', 'cumulative-sales.json');

await Bun.write(listFile, JSON.stringify(result, null, 4) + '\n');

console.log(chalk.green('\nSuccessfully updated cumulative sales data!'));

if (knownDatesWithInvalidData.length > 1) {
    console.log(chalk.yellow(`   The following ${knownDatesWithInvalidData.length} dates were previously marked as having invalid data:`));
    console.log(chalk.gray(`      ${knownDatesWithInvalidData.map((date) => date.dateString).join(', ')}`));
}

if (ignoredDatesWithInvalidData.length > 1) {
    console.log(
        chalk.yellow(`   The following ${ignoredDatesWithInvalidData.length} dates were detected as having invalid data and were ignored:`),
    );
    console.log(chalk.gray(`      ${ignoredDatesWithInvalidData.map((date) => `${date.marked} (actual: ${date.actual})`).join(', ')}`));

    const newDates = [...knownDatesWithInvalidData, ...ignoredDatesWithInvalidData]
        .sort((a, b) => a.date.getTime() - b.date.getTime()) // eslint-disable-line unicorn/no-array-sort
        .map((entry) => ('dateString' in entry ? entry.dateString : entry.marked));

    await Bun.write(cachedInvalidDatesLocation, JSON.stringify(newDates, null, 4) + '\n');
}
