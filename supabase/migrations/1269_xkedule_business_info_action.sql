-- Migration 1269: Xkedule business-info agent tool (AGT-09)
-- Adds the action_type behind `xkedule_business_info`, so an agent can read the
-- tenant's opening hours, address, timezone, service area and booking policies
-- (cancellation / no-show / late arrival / deposit) instead of improvising them.
-- Policy text in particular must never be invented — a wrong "yes, free
-- cancellation" is a refund argument with a real customer later.
-- PostgreSQL enum ADD VALUE must run outside a transaction block.

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_business_info';
