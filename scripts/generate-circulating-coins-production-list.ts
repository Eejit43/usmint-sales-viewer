import path from 'node:path';
import { styleText } from 'node:util';

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
    'Semiquincentennial 5 Cents': '5',
    'Semiquincentennial Dimes': '10',
    'Semiquincentennial Quarter Program': '25',
    'Semiquincentennial Half Dollars': '50',
    /* eslint-enable @typescript-eslint/naming-convention */
};

const tokenResponse = await fetch('https://www.usmint.gov/libs/granite/csrf/token.json');

const cookies = tokenResponse.headers.getSetCookie();

const htmlContent = await (
    await fetch('https://www.usmint.gov/about/production-sales-figures/circulating-coins-production', { headers: { cookie: cookies } })
).text();

const programData = (await JSON.parse(
    /data-tabletype="circulating" data-dropdownitems="(.*?)"/.exec(htmlContent)![1].replaceAll('&#34;', '"'),
)) as Record<string, string[]>;

const programs = Object.entries(programData).map(([program, years]) => ({
    id: program.split('|')[1],
    name: program.split('|')[0],
    years: years.map((year) => Number.parseInt(year)).sort((a, b) => a - b), // eslint-disable-line unicorn/no-array-sort
}));

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

for (const { id: programId, name: programName, years: programYears } of programs) {
    console.log(styleText('blue', `Procressing the ${styleText('yellow', programName)} program`));

    result[programName] = {};

    const reportDirectory = path.join('saved-reports', 'circulating-coins-production', programName);

    for (const [yearIndex, year] of programYears.entries()) {
        console.log(
            styleText(
                'blue',
                `   Processing year of ${styleText('yellow', year.toString())} (${styleText('gray', `${yearIndex + 1}/${programYears.length}`)})`,
            ),
        );

        result[programName][year] = {};

        const savedReportFile = Bun.file(path.join(reportDirectory, `${year}.json`));

        /* eslint-disable @typescript-eslint/naming-convention */
        type ProductionData =
            | {
                  'Design'?: string;
                  'President'?: string;
                  'AWQ Quarter'?: string;
                  'Semiquincentennial Quarter'?: string;
                  'Semi Q Quarters'?: string;
                  'Denver'?: string;
                  'Philadelphia'?: string;
                  'Total'?: string;
                  'Denver Coins (millions)'?: string;
                  'Philadelphia Coins (millions)'?: string;
                  'Total Coins (millions)'?: string;
              }[]
            | {
                  'Denomination': string;
                  'Denver'?: string;
                  'Philadelphia'?: string;
                  'Total'?: string;
                  'Denver Coins (millions)'?: string;
                  'Philadelphia Coins (millions)'?: string;
                  'Total Coins (millions)'?: string;
              }[]
            | { ''?: string; 'Denomination/ Mint'?: string }[];
        /* eslint-enable @typescript-eslint/naming-convention */

        let productionData: ProductionData;
        if (year < new Date().getFullYear() && (await savedReportFile.exists())) {
            console.log(styleText('green', '      Using saved report file'));
            productionData = (await savedReportFile.json()) as ProductionData;
        } else {
            const dataUrl = new URL(
                'https://www.usmint.gov/content/usmint/us/en/about/production-sales-figures/circulating-coins-production/jcr:content/root/container/productionsalesdata.dropdowns.json',
            );
            dataUrl.searchParams.set('firstDropdown', programId);
            dataUrl.searchParams.set('secondDropdown', year.toString());

            const processedData = (await (await fetch(dataUrl.toString(), { headers: { cookie: cookies } })).json()) as ProductionData;

            productionData = processedData;

            await Bun.write(savedReportFile, JSON.stringify(processedData));
        }

        for (const [designIndex, designData] of productionData.entries())
            if (
                'Design' in designData ||
                'President' in designData ||
                'AWQ Quarter' in designData ||
                'Semiquincentennial Quarter' in designData ||
                'Semi Q Quarters' in designData
            ) {
                if (
                    designData.Design === 'Total' ||
                    designData.Design === '' ||
                    designData.Design === 'Grand Total:' ||
                    designData.President === 'Total' ||
                    designData.President === year.toString() ||
                    designData['AWQ Quarter'] === 'Total' ||
                    designData['AWQ Quarter'] === '' ||
                    designData['Semiquincentennial Quarter'] === 'Total' ||
                    designData['Semi Q Quarters'] === 'Total'
                )
                    continue;

                const normalizedDesign =
                    'President' in designData
                        ? designData.President!
                        : (designData.Design?.replaceAll('Ω', ',') ??
                          designData['AWQ Quarter']?.replace(/^\d{4} /, '') ??
                          designData['Semiquincentennial Quarter'] ??
                          designData['Semi Q Quarters']!);

                result[programName][year][normalizedDesign] = {};

                for (const mint of mints)
                    if (designData[mint] || designData[`${mint} Coins (millions)`])
                        result[programName][year][normalizedDesign][mint] = parseMintage(
                            designData[mint] ?? designData[`${mint} Coins (millions)`]!,
                        );

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

                    result[programName][year][mint]![parsedDenomination] = parseMintage(
                        designData[mint] ?? designData[`${mint} Coins (millions)`]!,
                    );
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
                    styleText(
                        'red',
                        `      Unknown and unparsable data structure at index ${styleText('gray', `${designIndex}/${productionData.length - 1}`)}`,
                    ),
                );

        if (
            Object.keys(result[programName][year]).length === 0 ||
            Object.values(result[programName][year]).every((mintageData) => mintageData === null)
        )
            result[programName][year] = null;
    }

    if (Object.keys(result[programName]).length === 0) {
        console.log(styleText('red', '   No data found'));

        result[programName] = null;
    }
}

const listFile = path.join('lists', 'circulating-coins-production.json');

await Bun.write(listFile, JSON.stringify(result, null, 4) + '\n');

console.log(styleText('green', '\nSuccessfully updated circulating coins production data!'));
