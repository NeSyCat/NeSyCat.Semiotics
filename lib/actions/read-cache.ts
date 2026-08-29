// Server-only request-scoped memoization for read actions that multiple
// server components (layout + page, in the same render) each call
// independently — app/editor/layout.tsx, app/editor/page.tsx and
// app/editor/[id]/page.tsx all need getMe()/listDiagrams() results that are
// identical within one request cycle.
//
// Deliberately NOT a 'use server' module: getMe/listDiagrams are exported
// from 'use server' action files (lib/actions/organizations.ts,
// lib/actions/diagrams.ts) because they're also called as client-invocable
// actions elsewhere; wrapping them in React's cache() there would attach a
// non-async-function binding to a "use server" export, which the Next.js
// build enforcement rejects. This module sits beside those action files
// instead and re-exports memoized wrappers for server-component use only.
//
// cache() dedupes by arguments within a single request's render pass (and by
// identity of zero-arg calls), and is a no-op outside of React render — safe
// to import from anywhere without special-casing.
import { cache } from 'react'
import { getMe } from '@/lib/actions/organizations'
import { listDiagrams } from '@/lib/actions/diagrams'

export const getCachedMe = cache(getMe)
export const getCachedListDiagrams = cache(listDiagrams)
