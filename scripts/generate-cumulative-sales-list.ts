import chalk from 'chalk';
import path from 'node:path';

export type ItemsList = Record<string, { name: string; program: string; sales: number; firstSeen: string; latestData: string }>;

const tokenResponse = await fetch('https://www.usmint.gov/libs/granite/csrf/token.json');

const cookies = tokenResponse.headers.getSetCookie();

const processedCsvData = (await (
    await fetch('https://www.usmint.gov/content/dam/usmint/csv_data.1.json', { headers: { cookie: cookies } })
).json()) as Record<string, unknown>;

const processedDates = new Set<string>();

const dates = Object.keys(processedCsvData)
    .filter((fileName) => fileName.startsWith('CUM-'))
    .map((fileName) => {
        const { date, year, month, day } = /CUM-(?<date>(?<year>\d{4})-(?<month>\d{1,2})([\d.-])(?<day>\d{1,2})).csv$/.exec(fileName)!
            .groups as {
            date: string;
            year: string;
            month: string;
            day: string;
        };

        return { date: new Date(Number.parseInt(year), Number.parseInt(month) - 1, Number.parseInt(day)), id: date };
    })
    .filter(({ id }) => {
        if (processedDates.has(id)) return false;

        processedDates.add(id);

        return true;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

const reportDirectory = path.join('saved-reports', 'cumulative-sales');

const result: ItemsList = {};

const datesWithInvalidData = new Set([
    '2015-05-04',
    '2018-01-07',
    '2018-01-14',
    '2018-01-21',
    '2018-01-28',
    '2018-02-04',
    '2018-02-11',
    '2018-02-18',
    '2018-02-25',
    '2018-03-04',
    '2018-03-11',
    '2018-03-18',
    '2018-03-25',
    '2020-06-19',
]);

while (true) {
    const lastDate = dates.at(-1)!;

    const newDate = new Date(lastDate.date.getTime() + 7 * 24 * 60 * 60 * 1000);

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    if (newDate.getTime() >= currentDate.getTime()) break;

    dates.push({
        date: newDate,
        id: `${newDate.getFullYear()}-${(newDate.getMonth() + 1).toString().padStart(2, '0')}-${newDate.getDate().toString().padStart(2, '0')}`,
    });
}

const ignoredDatesWithInvalidFormat: string[] = [];
const ignoredDatesWithInvalidData: string[] = [];

for (const [index, { date, id: dateId }] of dates.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
        ignoredDatesWithInvalidFormat.push(dateId);

        continue;
    }

    if (datesWithInvalidData.has(dateId)) {
        ignoredDatesWithInvalidData.push(dateId);

        continue;
    }

    console.log(
        chalk.blue(
            `Processing week of ${chalk.yellow(
                date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
            )} (${chalk.gray(dateId)}) (${chalk.gray(`${index + 1}/${dates.length}`)})`,
        ),
    );

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
        const dataUrl = new URL('https://www.usmint.gov/bin/usmint/psd');
        dataUrl.searchParams.set('path', '/content/dam/usmint/csv_data');
        dataUrl.searchParams.set('date', dateId);

        try {
            salesData = (await (await fetch(dataUrl.toString(), { headers: { cookie: cookies } })).json()) as SalesData;
        } catch {
            console.log(chalk.red('   Failed to fetch data, skipping'));
            continue;
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

if (ignoredDatesWithInvalidFormat.length > 1) {
    console.log(chalk.yellow(`   The following ${ignoredDatesWithInvalidFormat.length} dates were ignored as they had an invalid format:`));
    console.log(chalk.gray(`      ${ignoredDatesWithInvalidFormat.join(', ')}`));
}

if (ignoredDatesWithInvalidData.length > 1) {
    console.log(chalk.yellow(`   The following ${ignoredDatesWithInvalidData.length} dates were ignored as they had invalid data:`));
    console.log(chalk.gray(`      ${ignoredDatesWithInvalidData.join(', ')}`));
}

if (ignoredDatesWithInvalidData.length !== datesWithInvalidData.size) {
    console.log(
        chalk.yellow(
            `   ${datesWithInvalidData.size} dates were marked as having invalid data in the config file, but only ${ignoredDatesWithInvalidData.length} of these dates were found. The following marked dates do not have data:`,
        ),
    );
    console.log(chalk.gray(`      ${[...datesWithInvalidData].filter((date) => !ignoredDatesWithInvalidData.includes(date)).join(', ')}`));
}
