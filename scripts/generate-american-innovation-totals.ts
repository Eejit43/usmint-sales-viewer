import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ItemsList } from './generate-cumulative-sales-list.js';

const listFile = Bun.file(path.join('lists', 'cumulative-sales.json'));
const totalsFile = path.join('lists', 'american-innovation-totals.json');

const stateNames: Record<string, string> = {
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
    MH: 'Marshall Islands',
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
    PW: 'Palau',
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

if (await listFile.exists()) {
    const listFileContent = (await listFile.json()) as ItemsList;

    if (existsSync(totalsFile)) rmSync(totalsFile);

    interface TotalInfo {
        total: number;
        soldOut: boolean;
        latestSales?: number[];
    }
    type MintMarkIndexedTotals = Record<string, TotalInfo>;

    const result: Record<string, Record<string, MintMarkIndexedTotals> | MintMarkIndexedTotals> = {};

    const filteredItems = Object.entries(listFileContent).filter(([name, item]) => name.includes('AI $1') && item.programName === 'Rolls & Bags & Boxes');

    for (const [name, item] of filteredItems) {
        const [, year, amount, stateAbbreviation, mintMark] = [...name.match(/(\d{4}) AI \$1 (25|100)-COIN (?:ROLL|BAG|)(?: - ([A-Z]{2}))? \((P|D)\)/)!];

        if (!(year in result)) result[year] = {};

        if (stateAbbreviation) {
            const stateName = stateNames[stateAbbreviation] ?? stateAbbreviation;

            if (!(stateName in result[year])) result[year][stateName] = {};

            if (!(mintMark in result[year][stateName])) (result[year][stateName] as MintMarkIndexedTotals)[mintMark] = { total: 0, soldOut: false, latestSales: [] };

            (result[year][stateName] as MintMarkIndexedTotals)[mintMark].total += item.totalSold * Number.parseInt(amount);
            (result[year][stateName] as MintMarkIndexedTotals)[mintMark].latestSales!.push(item.latestSaleData.week);
        } else {
            if (!(mintMark in result[year])) result[year][mintMark] = { total: 0, soldOut: false, latestSales: [] };

            (result[year] as MintMarkIndexedTotals)[mintMark].total += item.totalSold * Number.parseInt(amount);
            (result[year] as MintMarkIndexedTotals)[mintMark].latestSales!.push(item.latestSaleData.week);
        }
    }

    let latestYear = 0;
    const years = readdirSync(path.join('saved-reports', 'cumulative-sales'));
    for (const year of years) if (latestYear < Number.parseInt(year)) latestYear = Number.parseInt(year);

    let latestWeek = 0;
    const weeks = readdirSync(path.join('saved-reports', 'cumulative-sales', latestYear.toString()));
    for (const week of weeks) if (latestWeek < Number.parseInt(week) && Number.parseInt(week)) latestWeek = Number.parseInt(week);

    for (const [, data] of Object.entries(result))
        if ('latestSales' in Object.values(data)[0])
            for (const [, saleInfo] of Object.entries(data)) {
                if ((saleInfo as TotalInfo).latestSales!.every((week) => week < latestWeek)) (saleInfo as TotalInfo).soldOut = true;

                delete (saleInfo as TotalInfo).latestSales;
            }
        else
            for (const [, stateData] of Object.entries(data))
                for (const [, saleInfo] of Object.entries(stateData as MintMarkIndexedTotals)) {
                    if ((saleInfo as TotalInfo).latestSales!.every((week) => week < latestWeek)) (saleInfo as TotalInfo).soldOut = true;

                    delete (saleInfo as TotalInfo).latestSales;
                }

    Bun.write(totalsFile, JSON.stringify(result, null, 4) + '\n');
} else console.error('Cumulative sales data does not exist, generate that first!');
