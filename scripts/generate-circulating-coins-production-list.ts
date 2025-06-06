import chalk from 'chalk';
import path from 'node:path';

const mints = ['Philadelphia', 'Denver'] as const;

const denominations: Record<string, string> = {
    '1': 'Penny',
    '5': 'Nickel',
    '10': 'Dime',
    '25': 'Quarter',
    '50': 'Half Dollar',
    'N.A. $1': 'Native American Dollar', // eslint-disable-line @typescript-eslint/naming-convention
    'Pres. $1': 'Presidential Dollar', // eslint-disable-line @typescript-eslint/naming-convention
};

const alternativeDenominationNames: Record<string, string> = {
    /* eslint-disable @typescript-eslint/naming-convention */
    'Lincoln': '1',
    'Jefferson': '5',
    'Roosevelt': '10',
    'Quarter': '25',
    'Kennedy': '50',
    'Native American': 'N.A. $1',
    'Presidential': 'Pres. $1',
    /* eslint-enable @typescript-eslint/naming-convention */
};

const programs: Record<string, { name: string; years: string[] }> = {
    '50SQ': { name: '50 State Quarters', years: [] }, // eslint-disable-line @typescript-eslint/naming-convention
    'ATBQ': { name: 'America the Beautiful Quarters', years: [] },
    'AWQS': { name: 'American Women Quarters', years: [] },
    'CIRC': { name: 'Circulating Coins', years: [] },
    'DCTERR': { name: 'District of Columbia and US Territories Quarters', years: [] },
    'PRESDOLLAR': { name: 'Presidential One Dollar', years: [] },
    'WJNS': { name: 'Westward Journey Nickel Series', years: [] },
};

const programNameOverrides: Record<string, string> = { AWQ: 'AWQS' };

const tokenResponse = await fetch('https://www.usmint.gov/libs/granite/csrf/token.json');

const cookies = tokenResponse.headers.getSetCookie();

const processedCsvData = (await (
    await fetch('https://www.usmint.gov/content/dam/usmint/csv_data.1.json', { headers: { cookie: cookies } })
).json()) as Record<string, unknown>;

for (const fileName of Object.keys(processedCsvData)) {
    if (!fileName.startsWith('CIRC-')) continue;

    const { program, year } = /CIRC-(?<program>\w+)-(?<year>\d{4}).csv/.exec(fileName)!.groups as { program: string; year: string };

    programs[program].years.push(year);
}

for (const value of Object.values(programs)) value.years.sort();

const result: Record<string, Record<string, Record<string, Record<string, number> | null> | null> | null> = {};

/**
 * Formats a coin denomination to a standardized name.
 * @param denomination The denomination to format.
 */
function formatDenomination(denomination: string) {
    denomination = denomination.replace('Cent', '').replace('Pres ', 'Pres. ').trim();

    if (denomination === '') denomination = '1';

    return denominations[denomination];
}

/**
 * Parses a string value representing a coin's mintage into a number.
 * @param mintage The string value to parse.
 */
function parseMintage(mintage: string) {
    mintage = mintage.replace(/ ?M/, '').replaceAll('Ω', '');

    let parsedMintage = Number.parseFloat(mintage);

    if (parsedMintage < 10_000) parsedMintage *= 1_000_000;

    return Math.round(parsedMintage);
}

for (const [programId, { name: programName, years: programYears }] of Object.entries(programs)) {
    console.log(chalk.blue(`Procressing the ${chalk.yellow(programName)} program`));

    result[programName] = {};

    const reportDirectory = path.join('saved-reports', 'circulating-coins-production', programName);

    for (const [yearIndex, year] of programYears.entries()) {
        console.log(chalk.blue(`   Processing year of ${chalk.yellow(year)} (${chalk.gray(`${yearIndex + 1}/${programYears.length}`)})`));

        result[programName][year] = {};

        const savedReportFile = Bun.file(path.join(reportDirectory, `${year}.json`));

        /* eslint-disable @typescript-eslint/naming-convention */
        type ProductionData =
            | {
                  'Design'?: string;
                  'President'?: string;
                  'AWQ Quarter'?: string;
                  'Denver': string;
                  'Philadelphia': string;
                  'Total': string;
              }[]
            | { Denomination: string; Denver: string; Philadelphia: string; Total: string }[]
            | { ''?: string; 'Denomination/ Mint'?: string }[];
        /* eslint-enable @typescript-eslint/naming-convention */

        let productionData: ProductionData;
        if (Number.parseInt(year) < new Date().getFullYear() && (await savedReportFile.exists())) {
            console.log(chalk.green('      Using saved report file'));
            productionData = (await savedReportFile.json()) as ProductionData;
        } else {
            const dataUrl = new URL('https://www.usmint.gov/bin/usmint/psd');
            dataUrl.searchParams.set('path', '/content/dam/usmint/csv_data');
            dataUrl.searchParams.set('program', programNameOverrides[programId] ?? programId);
            dataUrl.searchParams.set('year', year);

            const processedData = (await (await fetch(dataUrl.toString(), { headers: { cookie: cookies } })).json()) as ProductionData;

            productionData = processedData;

            await Bun.write(savedReportFile, JSON.stringify(processedData));
        }

        for (const [designIndex, designData] of productionData.entries())
            if ('Design' in designData || 'President' in designData || 'AWQ Quarter' in designData) {
                if (
                    designData.Design === 'Total' ||
                    designData.Design === '' ||
                    designData.Design === 'Grand Total:' ||
                    designData.President === 'Total' ||
                    designData.President === year ||
                    designData['AWQ Quarter'] === 'Total' ||
                    designData['AWQ Quarter'] === ''
                )
                    continue;

                const normalizedDesign =
                    'President' in designData
                        ? designData.President!
                        : (designData.Design?.replaceAll('Ω', ',') ?? designData['AWQ Quarter']!.replace(/^\d{4} /, ''));

                result[programName][year][normalizedDesign] = {};

                for (const mint of mints)
                    if (designData[mint]) result[programName][year][normalizedDesign][mint] = parseMintage(designData[mint]);

                if (Object.keys(result[programName][year][normalizedDesign]).length === 0)
                    result[programName][year][normalizedDesign] = null;
            } else if ('Denomination' in designData) {
                if (designData.Denomination === 'Total' || designData.Denomination === '') continue;

                let parsedDenomination = designData.Denomination;

                for (const [name, value] of Object.entries(alternativeDenominationNames))
                    if (designData.Denomination.includes(name)) parsedDenomination = formatDenomination(value);

                if (!(year in result[programName])) result[programName][year] = {};

                for (const mint of mints) {
                    if (!(mint in result[programName][year])) result[programName][year][mint] = {};

                    result[programName][year][mint]![parsedDenomination] = parseMintage(designData[mint]);
                }
            } else if ('' in designData || 'Denomination/ Mint' in designData) {
                const mint = designData[''] ?? designData['Denomination/ Mint']!;

                if (!mints.includes(mint as (typeof mints)[number])) continue;

                const denominationSales = Object.entries(designData)
                    .filter(([key]) => !['', 'Denomination/ Mint', 'Total:'].includes(key))
                    .map(([denomination, mintage]) => [formatDenomination(denomination), parseMintage(mintage)]);

                result[programName][year][mint] = Object.fromEntries(denominationSales) as Record<string, number>;

                if (designIndex !== 0)
                    result[programName][year] = {
                        Philadelphia: result[programName][year].Philadelphia, // eslint-disable-line @typescript-eslint/naming-convention
                        Denver: result[programName][year].Denver, // eslint-disable-line @typescript-eslint/naming-convention
                    };
            } else
                console.log(
                    chalk.red(
                        `      Unknown and unparsable data structure at index ${chalk.gray(`${designIndex}/${productionData.length - 1}`)}`,
                    ),
                );

        if (
            Object.keys(result[programName][year]).length === 0 ||
            Object.values(result[programName][year]).every((mintageData) => mintageData === null)
        )
            result[programName][year] = null;
    }

    if (Object.keys(result[programName]).length === 0) {
        console.log(chalk.red('   No data found'));

        result[programName] = null;
    }
}

const listFile = path.join('lists', 'circulating-coins-production.json');

await Bun.write(listFile, JSON.stringify(result, null, 4) + '\n');

console.log(chalk.green('\nSuccessfully updated circulating coins production data!'));
