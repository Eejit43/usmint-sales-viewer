import chalk from 'chalk';
import { parse } from 'node-html-parser';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const rootDataUrl = new URL('https://www.usmint.gov/about/production-sales-figures/circulating-coins-production');

const listFile = join('lists', 'circulating-coins-production.json');

if (existsSync(listFile)) rmSync(listFile);

const processedRootData = parse(await (await fetch(rootDataUrl)).text());

const programSelectElement = processedRootData.querySelector('#program')!;

const programs = programSelectElement
    .querySelectorAll('option')
    .map((element) => element.getAttribute('value')!)
    .filter(Boolean);

const result: Record<string, Record<string, Record<string, Record<string, number>>>> = {};

for (const program of programs) {
    console.log(chalk.blue(`Procressing the ${chalk.yellow(program)} program`));

    result[program] = {};

    const programShortName = program.replaceAll(' ', '');
    const yearSelectElement = processedRootData.getElementById(`${programShortName}years`)!; // eslint-disable-line unicorn/prefer-query-selector

    const years = yearSelectElement
        .querySelectorAll('option')
        .map((option) => [option.getAttribute('value')!, option.textContent])
        .filter(([yearId]) => yearId)
        .reverse();

    const reportDirectory = join('saved-reports', 'circulating-coins-production', program);

    if (!existsSync(reportDirectory)) mkdirSync(reportDirectory, { recursive: true });

    for (const [index, [yearId, year]] of years.entries()) {
        console.log(chalk.blue(`   Processing year of ${chalk.yellow(year)} (${chalk.gray(yearId)}) (${chalk.gray(`${index + 1}/${years.length}`)})`));

        result[program][year] = {};

        const savedReportFile = Bun.file(join(reportDirectory, `${yearId}.txt`));

        let dataTable;
        if (await savedReportFile.exists()) {
            console.log(chalk.green('      Using saved report file'));
            dataTable = parse(await savedReportFile.text());
        } else {
            const dataUrl = new URL(rootDataUrl.toString());
            dataUrl.searchParams.set('program', program);
            dataUrl.searchParams.set(`${programShortName}years`, yearId.toString());

            const processedData = parse(await (await fetch(dataUrl)).text());

            dataTable = processedData.querySelector('table');

            if (!dataTable) {
                console.error('      Could not find data table!');

                continue;
            }

            const text = dataTable.outerHTML.replaceAll(/ ?(id|class)=".*?"/g, '').replaceAll(/\n\t?/g, '') + '\n';

            await Bun.write(savedReportFile, text);
        }

        let headers = dataTable.querySelectorAll('thead th').map((element) => element.textContent.trim());
        headers = headers.slice(1, -1);

        const rows = dataTable.querySelectorAll('tbody tr');

        for (const row of rows) {
            let columns = row.querySelectorAll('td').map((element) => element.textContent.trim());

            if (['', year, 'Total', 'Total:', 'Grand Total:'].includes(columns[0])) continue;

            const columnName = columns[0];

            result[program][year][columnName] = {};

            columns = columns.slice(1, -1);

            for (const [index, column] of columns.entries()) {
                const value = column.replaceAll(',', '');

                const parsedValue = value.endsWith('M') ? Number.parseFloat(value.replace(/ ?M/, '')) * 1_000_000 : Number.parseInt(value);

                result[program][year][columnName][headers[index].replaceAll(/\s{2,}/g, ' ')] = parsedValue;
            }
        }
    }
}

await Bun.write(listFile, JSON.stringify(result, null, 4) + '\n');
