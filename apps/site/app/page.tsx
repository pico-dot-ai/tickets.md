/* eslint-disable react/no-unescaped-entities */
"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const GITHUB_URL = "https://github.com/pico-dot-ai/tickets.md";

function ExternalLink({
  href,
  children
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Card({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="cardTitle">{title}</div>
      <div className="cardBody">{children}</div>
    </div>
  );
}

function GitHubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      {...props}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.33-1.29-1.69-1.29-1.69-1.06-.73.08-.72.08-.72 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.26 3.38.96.1-.76.41-1.27.74-1.56-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.68 5.39-5.23 5.68.43.37.81 1.11.81 2.24 0 1.62-.02 2.93-.02 3.33 0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function CopyBlock({ command }: { command: string }) {
  const isMultiLine = command.includes("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = command;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <div className={`codeBlock isCopyable ${isMultiLine ? "isMultiLine" : "isSingleLine"}`}>
      <pre className="codeBlockCode">
        <code>{command}</code>
      </pre>
      <button type="button" className="codeBlockCopy" onClick={copy} aria-label="Copy command">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
  );
}

export default function HomePage() {
  const slides = [
    {
      title: "Repo layout",
      footer: "Stable ticket definitions. Append-only run logs.",
      code: `.
├── TICKETS.md
├── AGENTS_EXAMPLE.md (or AGENTS.md with --apply)
└── .tickets/
    ├── spec/
    │   └── version/
    └── <ticket-id>/
        ├── ticket.md
        └── logs/
            └── <run>.jsonl`
    },
    {
      title: "CLI touchpoints",
      footer: "Validate, log runs, and keep history local.",
      code: `npx @picoai/tickets validate
npx @picoai/tickets log --ticket <id> --actor-type agent --summary "..." --machine`
    },
    {
      title: "Ticket anatomy",
      footer: "Keep tickets readable; move history to logs.",
      code: `Front matter (YAML)
---
id: <uuidv7>
title: "... "
status: todo
created_at: 2026-01-29T18:42:10Z
---
# Ticket
## Description
## Acceptance Criteria
## Verification`
    }
  ];

  const [active, setActive] = useState(1); // start at first real slide (index 1 due to leading clone)
  const [manualDelay, setManualDelay] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [displayIdx, setDisplayIdx] = useState(0); // index into slides
  const [fading, setFading] = useState(false);

  const displaySlides = [slides[slides.length - 1], ...slides, slides[0]]; // clone last + slides + clone first
  const firstRealIndex = 1;
  const lastRealIndex = slides.length - 1;

  const displayCount = displaySlides.length; // slides.length + 2
  const safeActive = ((active % displayCount) + displayCount) % displayCount;

  const realIndex =
    safeActive === 0
      ? slides.length - 1
      : safeActive === displayCount - 1
      ? 0
      : safeActive - 1;

  useEffect(() => {
    const baseDelay = 5200;
    const manualBonus = manualDelay ? 2000 : 0;
    const timer = setTimeout(() => {
      setActive((prev) => prev + 1);
      setIsTransitioning(true);
      setManualDelay(false);
    }, baseDelay + manualBonus);
    return () => clearTimeout(timer);
  }, [active, manualDelay]);

  const goTo = (next: number, manual = false) => {
    const minIndex = 0; // leading clone
    const maxIndex = displaySlides.length - 1; // trailing clone
    let target = next;

    if (next < minIndex) target = maxIndex - 1; // wrap to last real (just before trailing clone)
    if (next > maxIndex) target = minIndex + 1; // wrap to first real (just after leading clone)

    setIsTransitioning(true);
    setActive(target);
    if (manual) setManualDelay(true);
  };

  useEffect(() => {
    setFading(true);
    const t1 = setTimeout(() => {
      setDisplayIdx(realIndex);
    }, 120);
    const t2 = setTimeout(() => setFading(false), 320);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [realIndex]);

  useEffect(() => {
    if (!isTransitioning) {
      const t = setTimeout(() => setIsTransitioning(true), 20);
      return () => clearTimeout(t);
    }
  }, [isTransitioning]);

  const handleTransitionEnd = () => {
    if (safeActive === displayCount - 1) {
      // at trailing clone (first slide clone) -> jump to first real
      setIsTransitioning(false);
      setActive(firstRealIndex);
    } else if (safeActive === 0) {
      // at leading clone (last slide clone) -> jump to last real
      setIsTransitioning(false);
      setActive(lastRealIndex + 1); // last real in displaySlides index space
    }
  };

  return (
    <div className="bg">
      <header className="header">
        <div className="container headerInner">
          <div className="brand">
            <div className="brandMark" aria-hidden="true">
              <img src="/favicon.svg" alt="" className="brandMarkImg" />
            </div>
            <div className="brandText">
              <div className="brandName">TICKETS.md</div>
              <div className="brandTag">Agent-native in-repo ticketing</div>
            </div>
          </div>

          <nav className="nav" aria-label="Primary">
            <a className="cta" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon className="ctaIcon" />
              View on GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="container main">
        <section className="hero">
          <div className="heroLeft">
            <h1 className="h1">Tickets that work with agents.</h1>
            <p className="lead">
              A simple, flexible ticket format and CLI designed for parallel,
              long-running agentic development — without requiring a hosted service
              or network access.
            </p>

            <div className="heroActions">
              <a className="primaryButton" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GitHubIcon className="ctaIcon" />
                View on GitHub
              </a>
              <a className="secondaryButton" href="#how">
                Getting Started
              </a>
            </div>

            <div className="heroNote">
              Apache-2.0 license • Built for humans and machines
            </div>
          </div>

          <div className="heroRight" aria-hidden="true">
            <div className="codeCard">
              <div className="codeHeader">
                <div className="dot dotRed" />
                <div className="dot dotYellow" />
                <div className="dot dotGreen" />
                <div className="codeTitle">
                  <span className={`fadeSwap${fading ? " isFading" : ""}`}>
                    {slides[(displayIdx % slides.length + slides.length) % slides.length]?.title ?? " "}
                  </span>
                </div>
              </div>
              <div className="codeCarousel">
                <div
                  className="codeTrack"
                  style={{
                    transform: `translateX(-${safeActive * 100}%)`,
                    transition: isTransitioning ? "transform 0.6s ease" : "none"
                  }}
                  onTransitionEnd={handleTransitionEnd}
                >
                  {displaySlides.map((slide, i) => (
                    <div className="codeSlide" key={i}>
                      <pre className="code">
                        <code>{slide.code}</code>
                      </pre>
                    </div>
                  ))}
                </div>
                <div className="codeNav">
                  <button
                    type="button"
                    aria-label="Previous snippet"
                    onClick={() => goTo(active - 1, true)}
                    className="codeNavBtn"
                  >
                    ‹
                  </button>
                  <div className="codeDots" role="tablist" aria-label="Code snippets">
                    {slides.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Snippet ${i + 1}`}
                        aria-pressed={i === realIndex}
                        className={`codeDot${i === realIndex ? " isActive" : ""}`}
                        onClick={() => goTo(i + 1, true)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Next snippet"
                    onClick={() => goTo(active + 1, true)}
                    className="codeNavBtn"
                  >
                    ›
                  </button>
                </div>
              </div>
                <div className="codeFooter">
                  <span className={`fadeSwap${fading ? " isFading" : ""}`}>
                    {slides[(displayIdx % slides.length + slides.length) % slides.length]?.footer ?? " "}
                  </span>
                </div>
            </div>
          </div>
        </section>

        <section className="section" id="goals">
          <div className="goalsWrap">
          <h2 className="h2">Ticketing for Agent Teams</h2>
          <p className="p">
            Agentic coding tools are great at writing code, but they still have problems
            with <strong>staying coordinated</strong> over time. As additional agents are
            added to work on more complex tasks, having effective{" "}
            <strong>task tracking</strong>, <strong>context availability</strong>, and a
            clear <strong>understanding of work done</strong> becomes key.
          </p>
          <p className="p">
            <strong>TICKETS.md</strong> aims to address common issues with agentic
            development by providing a <strong>clear agent contract</strong>, an{" "}
            <strong>open</strong> and{" "}
            <strong>merge friendly in-repo ticket+context format</strong>, and{" "}
            <strong>simple tooling</strong> for the agent to work with tickets.
          </p>
          <div className="listGrid">
            <div className="listGridIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="listSvg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M16 13H8" />
                <path d="M16 17H8" />
                <path d="M10 9H8" />
              </svg>
            </div>
            <div className="listGridText">
              The <strong>TICKETS.md</strong> file is a human readable shared contract
              that tells the agent how to work with tickets, what the ticket format is,
              and what tooling is available to work with tickets.
            </div>

            <div className="listGridIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="listSvg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
                <circle cx="12" cy="9" r="0.3" />
                <circle cx="12" cy="12" r="0.3" />
                <circle cx="12" cy="15" r="0.3" />
              </svg>
            </div>
            <div className="listGridText">
              An agent friendly, in-repo <strong>ticket format</strong> provides a
              common mechanism for agents to keep track of scope, detail changes made,
              carry across context, and establish relationships between tickets. These
              act as history for agents, in a stable and merge-friendly way.
            </div>

            <div className="listGridIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="listSvg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <div className="listGridText">
              A set of <strong>simple CLI tools</strong> provides a consistent way for agents and humans
              to easily work with tickets.
            </div>
          </div>
          <p className="p">
            We’re not aiming to replace <strong>AGENTS.md</strong>, but to provide a
            contract with agents about how to define work, track changes, and carry over
            context. This separation keeps the ticket system stable, discoverable, and
            easy to integrate across different agentic environments.
          </p>
          </div>
        </section>

        <section className="section" id="how">
          <div className="quickstartBox">
            <div className="quickstartHeader">
              <h2 className="h2">Getting Started</h2>
              <p className="p">
                It's simple to add TICKETS.md to your repo with helpful scripts and templates.
                Make it your own and see how you can integrate to your agentic workflows.
              </p>
            </div>
            <div className="quickstartGrid">
              <div className="quickstartCol">
                <div className="quickstartPane">
                  <div className="qsStepTitle">Install the package</div>
                  <div className="qsStepDesc">
                    Add the package in the repo where you want to run Agent-First In-Repo Ticketing.
                  </div>
                  <CopyBlock command="npm install @picoai/tickets" />

                  <div className="qsStepTitle">Initialize in your repo</div>
                  <div className="qsStepDesc">
                    Bootstrap the ticket system assets from the package templates.
                  </div>
                  <CopyBlock command="npx @picoai/tickets init" />

                  <div className="qsStepTitle">Create a ticket</div>
                  <div className="qsStepDesc">
                    Create your first ticket; the CLI prints the UUIDv7 and creates its folder.
                  </div>
                  <CopyBlock command='npx @picoai/tickets new --title "Short title"' />
                </div>
              </div>

              <div className="quickstartCol">
                <div className="quickstartPane">
                  <div className="qsCardTitle">Anatomy of TICKETS.md</div>
                  <div className="qsStepDesc">
                    Initializing tickets in your repo will write the key files needed to manage ticket tracking.
                  </div>
                  <div className="codeBlock">
                    <pre className="codeBlockCode">
                      <code>{`.
├── TICKETS.md
├── AGENTS_EXAMPLE.md (or AGENTS.md with --apply)
└── .tickets/
    ├── spec/
    │   └── version/
    └── <ticket-id>/
        ├── ticket.md
        └── logs/
            └── <run>.jsonl`}</code>
                    </pre>
                  </div>
                  <div className="qsStepDesc">
                    Each ticket gets its own folder, a human readable Markdown definition, and append-only JSONL structured logs.
                  </div>
                  <div className="qsStepDesc">
                    Updates and context live in merge friendly logs, not a single file.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="get-involved">
          <h2 className="h2">Get involved</h2>
          <div className="grid">
            <Card title="Use it in a repo">
              Start with the canonical docs in <ExternalLink href={`${GITHUB_URL}/blob/main/TICKETS.md`}>TICKETS.md</ExternalLink>{" "}
              and the project overview in <ExternalLink href={`${GITHUB_URL}/blob/main/README.md`}>README.md</ExternalLink>.
            </Card>
            <Card title="Improve the spec">
              Propose fields, validation rules, and interoperability patterns that help
              agents collaborate across tools and branches.
            </Card>
            <Card title="Build integrations">
              IDE helpers, lightweight dashboards, CI checks, or agent harness adapters—
              all through the same repo-local interface.
            </Card>
          </div>

          <div className="foot">
            <div className="footLeft">TICKETS.md is a community project.</div>
            <div className="footRight">
              <ExternalLink href={GITHUB_URL}>GitHub</ExternalLink>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <ExternalLink href={`${GITHUB_URL}/blob/main/LICENSE`}>Apache-2.0</ExternalLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footerInner">
          <div className="muted">Made with Love and Codex</div>
        </div>
      </footer>
    </div>
  );
}
