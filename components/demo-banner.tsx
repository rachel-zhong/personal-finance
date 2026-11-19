/** Shown on every page of the demo website, so nobody mistakes it for real money. */
export default function DemoBanner() {
  return (
    <div role="note" className="w-full bg-accent px-4 py-1.5 text-center text-xs font-semibold text-accent-foreground">
      Sample data · every name and number here is made up
    </div>
  );
}
