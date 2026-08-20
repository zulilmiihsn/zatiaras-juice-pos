<div align="center">

# 💳 Zatiaras POS — Commercial Multi-Branch Retail & Revenue Engine

A production-grade, offline-resilient Point of Sale (POS) and inventory management platform built to scale daily commercial operations across retail branches.

[![Live Demo](https://img.shields.io/badge/Live_Application-Vercel-black?style=flat-square&logo=vercel)](https://zatiaraspos.vercel.app)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://kit.svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

[Explore Application](https://zatiaraspos.vercel.app) • [Business Value](#-business-value--problem-solved) • [Key Capabilities](#-key-capabilities) • [System Architecture](#-system-architecture)

</div>

---

## 💼 Business Value & Problem Solved

Independent retail and F&B businesses frequently struggle with fragmented inventory tracking, cash leaks during shift handovers, and system downtime during unstable internet connectivity.

**Zatiaras POS** was engineered as an all-in-one business operations solution:
- **Prevents Revenue Leakage**: Automated shift drawer tracking balances opening cash, daily cash in/out, and expected closing drawer amounts.
- **Continuous Business Uptime**: Full offline-first transaction support ensures cashiers never stop selling even when connectivity drops.
- **Actionable Decision Analytics**: Real-time sales velocities and product rankings empower managers to make data-driven restock decisions.

---

## ⚡ Key Capabilities

### 🛒 High-Velocity Checkout Terminal
- Instant product fuzzy-filtering and single-click cart management.
- Multi-channel payment reconciliation (Cash, QRIS, Bank Transfer).
- Automated receipt calculation and thermal printer connectivity.

### 🏢 Multi-Branch & Drawer Ledger
- Branch-scoped database separation and role-based permissions (Cashier vs Manager).
- Opening/Closing shift audits with WITA time-zone financial reports.
- Comprehensive expense and operating cost categorization.

### 🛡️ Resilience & Security
- Instant local caching for lightning-fast responsiveness under high load.
- PIN-protected manager override actions and immutable transaction logs.

---

## 🛠️ System Architecture

```text
├── Presentation Layer : SvelteKit 5, TypeScript, Tailwind CSS, PWA
├── Data & Real-time   : Supabase (PostgreSQL), Row-Level Security (RLS)
├── State & Caching    : Multi-tier offline memory & indexed storage cache
└── Infrastructure     : Vercel Cloud Edge Network
```

---

<div align="center">
  Crafted by <a href="https://github.com/zulilmiihsn"><strong>Zul Ilmi Ihsan</strong></a> • AI Product Engineer
</div>
