import Link from "next/link";
import { Waves } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import "../entry.css";

export default function LoginPage() {
  return <main className="login-shell"><Link href="/" className="entry-brand"><span><Waves size={25} /></span><strong>ClimateTwin <b>AI</b></strong></Link>
    <section className="login-card"><span className="entry-kicker">MANAGEMENT ACCESS</span><h1>Management Sign In</h1>
      <p>Sign in to access township monitoring and simulation controls.</p><LoginForm /></section>
    <Link className="login-back" href="/">← Back to welcome page</Link>
    <small>Synthetic township demonstration — not live flood information.</small></main>;
}
