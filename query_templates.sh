#!/bin/bash
# Query agent templates from the database

# Get MySQL container name
MYSQL_CONTAINER=$(docker ps --filter "ancestor=mysql" --format "{{.Names}}" | head -n 1)

if [ -z "$MYSQL_CONTAINER" ]; then
    echo "MySQL container not found. Trying common names..."
    MYSQL_CONTAINER="manager-api-mysql-1"
fi

echo "Using MySQL container: $MYSQL_CONTAINER"
echo "=========================================="
echo "Agent Templates in Database:"
echo "=========================================="

docker exec -i $MYSQL_CONTAINER mysql -uroot -p123456 cheeko_db << 'EOF'
SELECT id, agent_name, is_visible, sort 
FROM agent_template 
WHERE is_visible = 1 
ORDER BY sort;
EOF

echo ""
echo "=========================================="
echo "If the query failed, try manually with:"
echo "docker exec -it <container-name> mysql -uroot -p123456 cheeko_db"
echo "Then run: SELECT * FROM agent_template WHERE is_visible = 1;"
