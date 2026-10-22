-- Load authored-cards/audio migration first. Fixtures and access changes are rolled back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000009981');
insert into public.knowledge_areas(id,owner_id,title,color)
 values ('00000000-0000-4000-8000-000000009982','00000000-0000-4000-8000-000000009981','Note media','#123456');
insert into public.published_knowledge_area_versions(id,source_area_id,owner_id,version,content,content_hash,visibility)
 values ('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009982','00000000-0000-4000-8000-000000009981',1,
 '{"cards":[],"noteLibrary":{"notes":[{"media":[{"id":"note-image"}]}]}}',repeat('a',64),'public');
insert into public.shared_decks(deck_id,owner_id,visibility,latest_version_id,version)
 values ('00000000-0000-4000-8000-000000009982','00000000-0000-4000-8000-000000009981','public','00000000-0000-4000-8000-000000009983',1);
select set_config('request.jwt.claims','{}',true);
do $$ begin
 if not public.published_media_read_allowed('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009981','note-image',null) then raise exception 'public note-only media missing'; end if;
 if public.published_media_read_allowed('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009981','other-image',null) then raise exception 'unreferenced media allowed'; end if;
end $$;
update public.published_knowledge_area_versions set visibility='unlisted',share_token_hash=repeat('b',64) where id='00000000-0000-4000-8000-000000009983';
do $$ begin
 if public.published_media_read_allowed('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009981','note-image',null) then raise exception 'unlisted media leaked'; end if;
 if not public.published_media_read_allowed('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009981','note-image',repeat('b',64)) then raise exception 'authorized unlisted note media denied'; end if;
end $$;
update public.shared_decks set moderation_status='hidden' where deck_id='00000000-0000-4000-8000-000000009982';
do $$ begin
 if public.published_media_read_allowed('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009981','note-image',repeat('b',64)) then raise exception 'hidden media leaked'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000009981"}',true);
do $$ begin
 if not public.published_media_read_allowed('00000000-0000-4000-8000-000000009983','00000000-0000-4000-8000-000000009981','note-image',null) then raise exception 'owner note media denied'; end if;
end $$;
rollback;
