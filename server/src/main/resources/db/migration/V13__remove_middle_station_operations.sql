-- Log bounded topology deletion as a distinct operation; never rebase across it.
ALTER TABLE cloud_project_operations DROP CONSTRAINT cloud_project_operations_action_check;
ALTER TABLE cloud_project_operations ADD CONSTRAINT cloud_project_operations_action_check
    CHECK (action IN ('station.create','station.rename','station.move',
                     'segment.waypoint.move','line.append-existing','segment.split-station',
                     'line.remove-middle-station'));
