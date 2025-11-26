-- Fix: Enable the Cheeko template that's currently hidden
-- There are 2 Cheeko templates, both with is_visible=0
-- We'll enable the simpler one (id: 9406648b5cc5fde1b8aa335b6f8b4f76)

UPDATE ai_agent_template 
SET is_visible = 1, 
    sort = 0  -- Put it first in the list
WHERE id = '9406648b5cc5fde1b8aa335b6f8b4f76' 
AND agent_name = 'Cheeko';

-- Verify the change
SELECT id, agent_name, is_visible, sort 
FROM ai_agent_template 
WHERE is_visible = 1 
ORDER BY sort;
