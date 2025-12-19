"""
Migrate local ChromaDB to Chroma Cloud
Run: python migrate_to_cloud.py
"""
import chromadb

# Connect to LOCAL ChromaDB
print("Connecting to local ChromaDB...")
local_client = chromadb.PersistentClient(path='chroma_db')
local_collection = local_client.get_or_create_collection(name='story_pages')

# Get ALL documents from local
print("Reading from local ChromaDB...")
results = local_collection.get(include=['documents', 'metadatas', 'embeddings'])
print(f"Found {len(results['ids'])} documents to migrate")

# Connect to CLOUD ChromaDB
print("\nConnecting to Chroma Cloud...")
cloud_client = chromadb.CloudClient(
    tenant="31fbc2e5-a496-4295-bcbe-1cb2ab98be86",
    database="stories",
    api_key="ck-GBBgpVaaxzLKVsPxKiYtmAr3UCSRWAn1bo5CWwL2yqv4"
)

# Create/get collection in cloud
cloud_collection = cloud_client.get_or_create_collection(name='story_pages')
print(f"Cloud collection current count: {cloud_collection.count()}")

# Check if embeddings exist
has_embeddings = results['embeddings'] is not None and len(results['embeddings']) > 0

# Migrate in batches
batch_size = 50
total = len(results['ids'])

for i in range(0, total, batch_size):
    end = min(i + batch_size, total)
    batch_ids = results['ids'][i:end]
    batch_docs = results['documents'][i:end]
    batch_metas = results['metadatas'][i:end]

    if has_embeddings:
        batch_embeddings = results['embeddings'][i:end]
        cloud_collection.add(
            ids=batch_ids,
            documents=batch_docs,
            metadatas=batch_metas,
            embeddings=batch_embeddings
        )
    else:
        cloud_collection.add(
            ids=batch_ids,
            documents=batch_docs,
            metadatas=batch_metas
        )
    print(f"Migrated {end}/{total} documents...")

print(f"\nMigration complete! Cloud collection now has {cloud_collection.count()} documents")
