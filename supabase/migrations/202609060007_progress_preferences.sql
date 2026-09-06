alter table app.profile add column hide_streaks boolean not null default false;
grant update(hide_streaks) on app.profile to app_api;
