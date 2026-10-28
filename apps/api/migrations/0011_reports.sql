-- Sprint 10: what the reports need to put a cost on time and a value on work.
-- Salaries are sensitive: the API shows them only to owners and admins.

-- Monthly cost of a person (salary and the like), in the workspace currency.
alter table memberships add column monthly_cost numeric(14, 2) check (monthly_cost is null or monthly_cost >= 0);

alter table workspaces
  -- Working hours in a month, to turn a monthly cost into an hourly one (22 days × 8 h).
  add column monthly_hours smallint not null default 176 check (monthly_hours between 1 and 744),
  -- Exchange rates into the workspace currency: {"USD": 280} means 1 USD = 280 of it.
  add column fx_rates jsonb not null default '{}';

-- Time-and-materials projects: billable hours × this rate is their revenue.
alter table projects
  add column hourly_rate numeric(12, 2) check (hourly_rate is null or hourly_rate >= 0),
  add column rate_currency text;
