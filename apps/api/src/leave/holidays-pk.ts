// Pakistan's public holidays. Fixed dates are certain; the Islamic ones follow the
// moon and are estimates until the government announces them, so they're loaded as
// "estimated" and stay editable.

export interface PresetHoliday {
  date: string;
  name: string;
  estimated: boolean;
  /** Stable key, so loading a year twice doesn't duplicate anything. */
  key: string;
}

const FIXED: { month: number; day: number; name: string; slug: string }[] = [
  { month: 2, day: 5, name: 'Kashmir Solidarity Day', slug: 'kashmir' },
  { month: 3, day: 23, name: 'Pakistan Day', slug: 'pakistan-day' },
  { month: 5, day: 1, name: 'Labour Day', slug: 'labour' },
  { month: 5, day: 28, name: 'Youm-e-Takbeer', slug: 'takbeer' },
  { month: 8, day: 14, name: 'Independence Day', slug: 'independence' },
  { month: 11, day: 9, name: 'Iqbal Day', slug: 'iqbal' },
  { month: 12, day: 25, name: 'Quaid-e-Azam Day', slug: 'quaid' },
];

/** Estimated (astronomical) dates; Pakistan announces the final ones after moon sighting. */
const ISLAMIC: Record<number, { slug: string; name: string; dates: string[] }[]> = {
  2026: [
    { slug: 'eid-ul-fitr', name: 'Eid ul-Fitr', dates: ['2026-03-20', '2026-03-21', '2026-03-22'] },
    { slug: 'eid-ul-adha', name: 'Eid ul-Adha', dates: ['2026-05-27', '2026-05-28', '2026-05-29'] },
    { slug: 'ashura', name: 'Ashura', dates: ['2026-06-24', '2026-06-25'] },
    { slug: 'milad', name: 'Eid Milad-un-Nabi', dates: ['2026-08-25'] },
  ],
  2027: [
    { slug: 'eid-ul-fitr', name: 'Eid ul-Fitr', dates: ['2027-03-10', '2027-03-11', '2027-03-12'] },
    { slug: 'eid-ul-adha', name: 'Eid ul-Adha', dates: ['2027-05-17', '2027-05-18', '2027-05-19'] },
    { slug: 'ashura', name: 'Ashura', dates: ['2027-06-14', '2027-06-15'] },
    { slug: 'milad', name: 'Eid Milad-un-Nabi', dates: ['2027-08-15'] },
  ],
  2028: [
    { slug: 'eid-ul-fitr', name: 'Eid ul-Fitr', dates: ['2028-02-27', '2028-02-28', '2028-02-29'] },
    { slug: 'eid-ul-adha', name: 'Eid ul-Adha', dates: ['2028-05-05', '2028-05-06', '2028-05-07'] },
    { slug: 'ashura', name: 'Ashura', dates: ['2028-06-02', '2028-06-03'] },
    { slug: 'milad', name: 'Eid Milad-un-Nabi', dates: ['2028-08-03'] },
  ],
};

export const PRESET_YEARS = Object.keys(ISLAMIC).map(Number);

const pad = (n: number) => String(n).padStart(2, '0');

export function pakistanHolidays(year: number): PresetHoliday[] {
  const fixed = FIXED.map((h) => ({
    date: `${year}-${pad(h.month)}-${pad(h.day)}`,
    name: h.name,
    estimated: false,
    key: `pk:${year}:${h.slug}`,
  }));
  const islamic = (ISLAMIC[year] ?? []).flatMap((h) =>
    h.dates.map((date, i) => ({
      date,
      name: h.dates.length > 1 ? `${h.name} (day ${i + 1})` : h.name,
      estimated: true,
      key: `pk:${year}:${h.slug}:${i + 1}`,
    })),
  );
  return [...fixed, ...islamic].sort((a, b) => a.date.localeCompare(b.date));
}
