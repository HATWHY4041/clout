import { PerpsApp } from "@/components/perps";

export const metadata = { title: "Clout Perps · long or short a token's hype" };

export default function Perps() {
  return (
    <>
      <section className="hero slim">
        <div className="tag">perpetual futures on attention</div>
        <h1>Long the <span className="hl">hype</span>. Short the fade.</h1>
        <p className="lede">
          Trade a token&apos;s Clout Score with up to 5x leverage. No expiry, funding keeps both sides honest, and every
          price lands on-chain from public data.
        </p>
      </section>
      <PerpsApp />
    </>
  );
}
