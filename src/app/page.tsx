import { Board, CreateMarket, Markets } from "@/components/home";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="tag">prediction markets on attention · solana</div>
        <h1>
          Trade the <span className="hl">hype</span>,<br />not the price.
        </h1>
        <p className="lede">
          Every token gets a live <b>Clout Score</b> (0–100) built from public trading data. Paste any tweet and
          turn it into a YES/NO market on whether the hype holds. Share it as a Blink and people bet right from X.
        </p>
        <CreateMarket />
      </section>
      <Board />
      <Markets />
    </>
  );
}
