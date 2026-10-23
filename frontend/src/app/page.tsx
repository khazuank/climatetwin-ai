import Link from "next/link";
import { House, ShieldCheck, Waves, ArrowUpRight } from "lucide-react";
import "./entry.css";

export default function Home() {
  return <main className="entry-shell">
    <header className="entry-header"><Link href="/" className="entry-brand"><span><Waves size={25} /></span><strong>ClimateTwin <b>AI</b></strong></Link><span>Smart Township Flood Intelligence</span></header>
    <section className="entry-hero"><span className="entry-kicker">A clearer view of a changing township</span>
      <h1>Flood intelligence for <em>every decision.</em></h1>
      <p>Explore township flood conditions, understand what may happen next, and find safer routes during simulated flooding.</p>
    </section>
    <section className="entry-options" aria-label="Choose your experience">
      <article className="entry-card"><div className="entry-icon"><ShieldCheck size={28} /></div><span className="entry-card-label">OPERATIONS</span><h2>Management</h2>
        <p>Monitor township flooding, explore AI predictions and manage simulated flood responses.</p>
        <Link href="/login">Management Sign In <ArrowUpRight size={18} /></Link></article>
      <article className="entry-card"><div className="entry-icon resident"><House size={28} /></div><span className="entry-card-label">COMMUNITY</span><h2>Resident Safety</h2>
        <p>Check flood warnings near your home and find available routes to the community shelter.</p>
        <Link href="/resident">Continue as Resident <ArrowUpRight size={18} /></Link></article>
    </section>
    <footer className="entry-footer">Synthetic township demonstration — not live flood information.</footer>
  </main>;
}
