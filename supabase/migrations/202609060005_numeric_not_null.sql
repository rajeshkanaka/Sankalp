-- SQL CHECK accepts unknown; make numeric presence explicit at the persistence boundary.
alter table app.practice_version add constraint numeric_target_present
  check (kind = 'checkbox' or target is not null);
alter table app.session_practice add constraint numeric_value_present
  check (kind = 'checkbox' or numeric_value is not null);
