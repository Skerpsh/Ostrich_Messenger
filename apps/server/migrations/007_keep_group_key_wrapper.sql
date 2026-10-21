-- Who wrapped a group key stays known after their account is deleted:
-- clients trust a key only if they can check its wrapper's public key
-- against the one they know for that user, and without the id the server
-- could hand out a key of its own. So wrapper_id is no longer a foreign
-- key (which set it to NULL on deletion). Keys whose wrapper was already
-- deleted keep NULL; clients no longer accept those.
ALTER TABLE group_keys DROP CONSTRAINT IF EXISTS group_keys_wrapper_id_fkey;
