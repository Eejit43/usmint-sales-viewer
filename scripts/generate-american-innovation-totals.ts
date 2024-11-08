import path from 'node:path';
import type { ItemsList } from './generate-cumulative-sales-list.js';

const salesFile = Bun.file(path.join('lists', 'cumulative-sales.json'));
const totalsFile = path.join('lists', 'american-innovation-totals.json');

const stateTerritoryNames: Record<string, string> = {
    AL: 'Alabama',
    AK: 'Alaska',
    AS: 'American Samoa',
    AZ: 'Arizona',
    AR: 'Arkansas',
    CA: 'California',
    CO: 'Colorado',
    CT: 'Connecticut',
    DE: 'Delaware',
    DC: 'District of Columbia',
    FL: 'Florida',
    GA: 'Georgia',
    GU: 'Guam',
    HI: 'Hawaii',
    ID: 'Idaho',
    IL: 'Illinois',
    IN: 'Indiana',
    IA: 'Iowa',
    KS: 'Kansas',
    KY: 'Kentucky',
    LA: 'Louisiana',
    ME: 'Maine',
    MD: 'Maryland',
    MA: 'Massachusetts',
    MI: 'Michigan',
    MN: 'Minnesota',
    MS: 'Mississippi',
    MO: 'Missouri',
    MT: 'Montana',
    NE: 'Nebraska',
    NV: 'Nevada',
    NH: 'New Hampshire',
    NJ: 'New Jersey',
    NM: 'New Mexico',
    NY: 'New York',
    NC: 'North Carolina',
    ND: 'North Dakota',
    MP: 'Northern Mariana Islands',
    OH: 'Ohio',
    OK: 'Oklahoma',
    OR: 'Oregon',
    PA: 'Pennsylvania',
    PR: 'Puerto Rico',
    RI: 'Rhode Island',
    SC: 'South Carolina',
    SD: 'South Dakota',
    TN: 'Tennessee',
    TX: 'Texas',
    UT: 'Utah',
    VT: 'Vermont',
    VI: 'Virgin Islands',
    VA: 'Virginia',
    WA: 'Washington',
    WV: 'West Virginia',
    WI: 'Wisconsin',
    WY: 'Wyoming',
};

const mints: Record<string, string> = {
    P: 'Philadelphia',
    D: 'Denver',
};

if (await salesFile.exists()) {
    const listFileContent = (await salesFile.json()) as ItemsList;

    interface TotalInfo {
        total: number;
        soldOut: boolean;
        latestSales?: string[];
    }

    type MintMarkIndexedTotals = Record<string, TotalInfo>;

    const result: Record<string, Record<string, MintMarkIndexedTotals> | MintMarkIndexedTotals> = {};

    const filteredItems = Object.values(listFileContent).filter(
        ({ name, program }) => name.includes('AI $1') && program === 'Rolls & Bags & Boxes',
    );

    for (const item of filteredItems) {
        const [, year, amount, stateAbbreviation, mintMark] = [
            .../(\d{4}) AI \$1 (25|100)-COIN (?:ROLL|BAG|)(?: - ([A-Z]{2}))? \((P|D)\)/.exec(item.name)!,
        ];

        const mint = mints[mintMark];

        if (!(year in result)) result[year] = {};

        if (stateAbbreviation) {
            const stateName = stateTerritoryNames[stateAbbreviation] ?? stateAbbreviation;

            if (!(stateName in result[year])) result[year][stateName] = {};

            if (!(mint in result[year][stateName]))
                (result[year][stateName] as MintMarkIndexedTotals)[mint] = { total: 0, soldOut: false, latestSales: [] };

            (result[year][stateName] as MintMarkIndexedTotals)[mint].total += item.sales * Number.parseInt(amount);
            (result[year][stateName] as MintMarkIndexedTotals)[mint].latestSales!.push(item.latestData);
        } else {
            if (!(mint in result[year])) result[year][mint] = { total: 0, soldOut: false, latestSales: [] };

            (result[year] as MintMarkIndexedTotals)[mint].total += item.sales * Number.parseInt(amount);
            (result[year] as MintMarkIndexedTotals)[mint].latestSales!.push(item.latestData);
        }
    }

    const lastSaleDataDate = Object.values(listFileContent).at(-1)!.latestData;

    for (const data of Object.values(result))
        if ('latestSales' in Object.values(data)[0])
            for (const [, saleInfo] of Object.entries(data)) {
                if ((saleInfo as TotalInfo).latestSales!.every((week) => week !== lastSaleDataDate)) (saleInfo as TotalInfo).soldOut = true;

                delete (saleInfo as TotalInfo).latestSales;
            }
        else
            for (const [, stateData] of Object.entries(data))
                for (const [, saleInfo] of Object.entries(stateData as MintMarkIndexedTotals)) {
                    if (saleInfo.latestSales!.every((week) => week !== lastSaleDataDate)) saleInfo.soldOut = true;

                    delete saleInfo.latestSales;
                }

    Bun.write(totalsFile, JSON.stringify(result, null, 4) + '\n');
} else console.error('Cumulative sales data does not exist, generate that first!');
