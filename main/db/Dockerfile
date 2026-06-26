FROM postgres:18
# init SQL/scripts placed in db/initdb/ run on first container start
COPY initdb/ /docker-entrypoint-initdb.d/
