-- The trusted_contacts_telegram_code trigger always sets telegram_code on insert. A placeholder
-- default keeps the column optional for API clients (and in the generated types), which never
-- choose the code themselves.
alter table public.trusted_contacts alter column telegram_code set default '';
