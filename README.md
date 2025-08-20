# CLX Finance V1 (Frontend, ohne Login)

Minimalistische Web-App für Einnahmen, Ausgaben, Projekte, Kunden und Dokumente (Offerten/Rechnungen) + Dashboard & Kalender.

## Setup
1) **Supabase** Projekt anlegen → im Dashboard **SQL Editor** öffnen → `schema.sql` ausführen.
2) In `supabase.js` **SUPABASE_URL** und **SUPABASE_ANON_KEY** eintragen.
3) Lokal öffnen (Doppelklick auf `index.html`) **oder** auf GitHub Pages / Netlify / Vercel deployen.

## Features (V1)
- Dashboard: KPIs (Monat), Jahres-Chart (Chart.js) + Kalender (FullCalendar) mit Events (klick zum Erstellen).
- Einnahmen/Ausgaben: Anlegen + Liste + Löschen.
- Projekte: Anlegen + Finanzübersicht pro Projekt (View `v_projects_financials`) + Löschen.
- Kunden: Anlegen + Liste + Löschen.
- Dokumente: Offerten / Rechnungen mit Positionen, Autonummer, Summe & MWST, Liste + Löschen.

> Hinweis: Ohne Login sind Tabellen öffentlich (RLS aus). Für Produktion unbedingt absichern!
