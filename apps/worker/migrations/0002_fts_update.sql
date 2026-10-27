-- Volltextsuche aktuell halten, wenn eine Meldung aktualisiert wird (z. B. wiederholte Erinnerungen).

CREATE TRIGGER notifications_fts_update AFTER UPDATE OF title, body, tags ON notifications BEGIN
  UPDATE notifications_fts SET
    title = new.title,
    body = coalesce(new.body, ''),
    tags = (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.tags))
  WHERE rowid = new.rowid;
END;
