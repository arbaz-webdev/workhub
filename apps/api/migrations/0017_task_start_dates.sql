-- Phase 2: Gantt and calendar views. A task can have a start as well as a due date.
alter table tasks add column start_date date;
alter table tasks add constraint tasks_dates_in_order check (start_date is null or due_date is null or start_date <= due_date);
