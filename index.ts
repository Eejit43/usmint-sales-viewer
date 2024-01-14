import { parse } from 'node-html-parser';

// eslint-disable-next-line unicorn/prefer-top-level-await
(async () => {
    const currentYear = new Date().getFullYear();
    const startYear = 2015;

    const years = Array.from({ length: currentYear - startYear + 1 }).map((value, index) => index + startYear);

    const result: Record<number, string[]> = {};

    const rootSalesDirectory = 'https://www.usmint.gov/about/production-sales-figures/cumulative-sales';

    const processedRootSalesDirectory = parse(await (await fetch(rootSalesDirectory)).text());

    for (const year of years) {
        const selectElement = processedRootSalesDirectory.querySelector(`#${year}weeks`);
        if (!selectElement) continue;

        const optionElements = selectElement.querySelectorAll('option');

        result[year] = optionElements.map((option) => option.getAttribute('value')).filter(Boolean) as string[];
    }

    console.log(result);
})();
