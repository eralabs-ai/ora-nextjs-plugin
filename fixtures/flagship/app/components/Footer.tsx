const COLUMNS: { title: string; links: string[] }[] = [
  { title: 'Company', links: ['About us', 'Careers', 'Press', 'Investors'] },
  { title: 'Travel', links: ['Destinations', 'Baggage', 'Special assistance', 'Group travel'] },
  { title: 'Loyalty', links: ['Ora Miles', 'Status tiers', 'Partners'] },
  { title: 'Legal', links: ['Privacy', 'Terms & conditions', 'Cookie settings', 'Contact'] },
];

export default function Footer() {
  return (
    <div className="mt-20 bg-navy-deep text-white/60">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 py-14 md:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="mb-4 text-[12px] font-semibold tracking-[0.14em] text-white/85 uppercase">
              {col.title}
            </div>
            {col.links.map((link) => (
              <div
                key={link}
                className="mb-2.5 cursor-pointer text-[13.5px] transition-colors hover:text-white"
              >
                {link}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-6 py-5 text-[12px]">
          © {new Date().getFullYear()} Ora Air. All rights reserved.
        </div>
      </div>
    </div>
  );
}
