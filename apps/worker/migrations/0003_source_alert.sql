-- Pro Quelle einstellbar: Das Dashboard klingelt und meldet sich, wenn von dieser Quelle etwas Neues kommt.

ALTER TABLE sources ADD COLUMN alert INTEGER NOT NULL DEFAULT 0;
