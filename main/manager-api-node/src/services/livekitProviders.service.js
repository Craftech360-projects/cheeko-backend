const { prisma } = require('../config/database');

const toNullableString = (value) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
};

const toRequiredString = (value, fieldName) => {
  const out = toNullableString(value);
  if (!out) throw new Error(`${fieldName} is required`);
  return out;
};

const toOptionalInt = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} must be an integer`);
  return parsed;
};

const toOptionalFloat = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} must be a number`);
  return parsed;
};

const pickLatestUpdatedAt = (rows) => {
  let latest = null;
  for (const row of rows) {
    if (!row || !row.updated_at) continue;
    const ts = new Date(row.updated_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest ? new Date(latest).toISOString() : null;
};

const providerModels = {
  llm: {
    delegate: 'llm_providers',
    updateFields: {
      model_name: 'string',
      model: 'string',
      api_base: 'nullableString',
      api_key: 'string',
      priority: 'int',
      config_json: 'json'
    }
  },
  stt: {
    delegate: 'stt_providers',
    updateFields: {
      provider_name: 'string',
      model: 'string',
      language: 'nullableString',
      sample_rate: 'int',
      api_key: 'string',
      priority: 'int',
      config_json: 'json'
    }
  },
  tts: {
    delegate: 'tts_providers',
    updateFields: {
      provider_name: 'string',
      voice_id: 'nullableString',
      model_id: 'nullableString',
      output_format: 'nullableString',
      sample_rate_hz: 'nullableInt',
      temperature: 'float',
      api_key: 'string',
      priority: 'int',
      config_json: 'json'
    }
  }
};

const getProviderModel = (type) => {
  const model = providerModels[String(type || '').toLowerCase()];
  if (!model) throw new Error('Invalid provider type');
  return model;
};

const parseProviderId = (id) => {
  const value = toRequiredString(id, 'id');
  if (!/^\d+$/.test(value)) throw new Error('id must be a positive integer');
  return BigInt(value);
};

const normalizeProviderRow = (row) => {
  if (!row) return null;
  const normalized = { ...row };
  if (normalized.id !== undefined && normalized.id !== null) {
    normalized.id = normalized.id.toString();
  }
  if (normalized.temperature !== undefined && normalized.temperature !== null) {
    normalized.temperature = Number(normalized.temperature);
  }
  return normalized;
};

const coerceUpdateValue = (value, type, fieldName) => {
  if (type === 'string') return toNullableString(value) || '';
  if (type === 'nullableString') return toNullableString(value);
  if (type === 'int') return toOptionalInt(value, fieldName) ?? 0;
  if (type === 'nullableInt') return toOptionalInt(value, fieldName);
  if (type === 'float') {
    const parsed = toOptionalFloat(value, fieldName);
    return parsed === null || parsed === undefined ? null : Number(parsed.toFixed(2));
  }
  if (type === 'json') {
    if (value === undefined) return undefined;
    if (value === null || typeof value === 'object') return value;
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
};

const buildProviderUpdateData = (model, payload = {}) => {
  const data = { updated_at: new Date() };

  for (const [fieldName, fieldType] of Object.entries(model.updateFields)) {
    if (payload[fieldName] === undefined) continue;
    data[fieldName] = coerceUpdateValue(payload[fieldName], fieldType, fieldName);
  }

  return data;
};

const listProviders = async () => {
  const orderBy = [{ is_active: 'desc' }, { priority: 'desc' }, { updated_at: 'desc' }];
  const [llm, stt, tts] = await Promise.all([
    prisma.llm_providers.findMany({ orderBy }),
    prisma.stt_providers.findMany({ orderBy }),
    prisma.tts_providers.findMany({ orderBy })
  ]);

  return {
    llm: (llm || []).map(normalizeProviderRow),
    stt: (stt || []).map(normalizeProviderRow),
    tts: (tts || []).map(normalizeProviderRow)
  };
};

const updateProvider = async (type, id, payload = {}) => {
  const model = getProviderModel(type);
  const delegate = prisma[model.delegate];
  const updateData = buildProviderUpdateData(model, payload);

  const updated = await delegate.update({
    where: { id: parseProviderId(id) },
    data: updateData
  });

  return normalizeProviderRow(updated);
};

const activateProvider = async (type, id) => {
  const model = getProviderModel(type);
  const delegateName = model.delegate;

  const updated = await prisma.$transaction(async (tx) => {
    await tx[delegateName].updateMany({
      where: { is_active: true },
      data: { is_active: false, updated_at: new Date() }
    });

    return tx[delegateName].update({
      where: { id: parseProviderId(id) },
      data: { is_active: true, updated_at: new Date() }
    });
  });

  return normalizeProviderRow(updated);
};

const getActiveProviders = async () => {
  const [llm, stt, tts] = await Promise.all([
    prisma.llm_providers.findFirst({
      where: { is_active: true },
      orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }]
    }),
    prisma.stt_providers.findFirst({
      where: { is_active: true },
      orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }]
    }),
    prisma.tts_providers.findFirst({
      where: { is_active: true },
      orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }]
    })
  ]);

  return {
    updated_at: pickLatestUpdatedAt([llm, stt, tts]),
    llm: llm ? {
      model_name: llm.model_name,
      model: llm.model,
      api_base: llm.api_base || null,
      api_key: llm.api_key || ''
    } : null,
    stt: stt ? {
      provider: stt.provider_name,
      model: stt.model || '',
      language: stt.language || '',
      api_key: stt.api_key || ''
    } : null,
    tts: tts ? {
      provider: tts.provider_name,
      voice_id: tts.voice_id || '',
      model_id: tts.model_id || '',
      output_format: tts.output_format || '',
      sample_rate_hz: tts.sample_rate_hz || 0,
      temperature: (tts.temperature === null || tts.temperature === undefined) ? 0 : Number(tts.temperature),
      api_key: tts.api_key || ''
    } : null
  };
};

const setActiveLLMProvider = async (payload = {}) => {
  const modelName = toRequiredString(payload.model_name, 'model_name');
  const model = toRequiredString(payload.model, 'model');
  const apiBase = toNullableString(payload.api_base);
  const apiKey = toNullableString(payload.api_key) || '';
  const priority = toOptionalInt(payload.priority, 'priority') ?? 0;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.llm_providers.updateMany({
      where: { is_active: true },
      data: { is_active: false, updated_at: new Date() }
    });

    return tx.llm_providers.upsert({
      where: { model_name: modelName },
      create: {
        model_name: modelName,
        model,
        api_base: apiBase,
        api_key: apiKey,
        is_active: true,
        priority
      },
      update: {
        model,
        api_base: apiBase,
        api_key: apiKey,
        is_active: true,
        priority,
        updated_at: new Date()
      }
    });
  });

  return updated;
};

const setActiveSTTProvider = async (payload = {}) => {
  const providerName = toRequiredString(payload.provider, 'provider');
  const model = toNullableString(payload.model) || '';
  const language = toNullableString(payload.language);
  const apiKey = toNullableString(payload.api_key) || '';
  const priority = toOptionalInt(payload.priority, 'priority') ?? 0;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.stt_providers.updateMany({
      where: { is_active: true },
      data: { is_active: false, updated_at: new Date() }
    });

    return tx.stt_providers.upsert({
      where: { provider_name: providerName },
      create: {
        provider_name: providerName,
        model,
        language,
        api_key: apiKey,
        is_active: true,
        priority
      },
      update: {
        model,
        language,
        api_key: apiKey,
        is_active: true,
        priority,
        updated_at: new Date()
      }
    });
  });

  return updated;
};

const setActiveTTSProvider = async (payload = {}) => {
  const providerName = toRequiredString(payload.provider, 'provider');
  const voiceID = toNullableString(payload.voice_id);
  const modelID = toNullableString(payload.model_id);
  const outputFormat = toNullableString(payload.output_format);
  const sampleRateHz = toOptionalInt(payload.sample_rate_hz, 'sample_rate_hz');
  const temperature = toOptionalFloat(payload.temperature, 'temperature');
  const apiKey = toNullableString(payload.api_key) || '';
  const priority = toOptionalInt(payload.priority, 'priority') ?? 0;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.tts_providers.updateMany({
      where: { is_active: true },
      data: { is_active: false, updated_at: new Date() }
    });

    return tx.tts_providers.upsert({
      where: { provider_name: providerName },
      create: {
        provider_name: providerName,
        voice_id: voiceID,
        model_id: modelID,
        output_format: outputFormat,
        sample_rate_hz: sampleRateHz,
        temperature: (temperature === null || temperature === undefined) ? null : Number(temperature.toFixed(2)),
        api_key: apiKey,
        is_active: true,
        priority
      },
      update: {
        voice_id: voiceID,
        model_id: modelID,
        output_format: outputFormat,
        sample_rate_hz: sampleRateHz,
        temperature: (temperature === null || temperature === undefined) ? null : Number(temperature.toFixed(2)),
        api_key: apiKey,
        is_active: true,
        priority,
        updated_at: new Date()
      }
    });
  });

  return updated;
};

module.exports = {
  listProviders,
  updateProvider,
  activateProvider,
  getActiveProviders,
  setActiveLLMProvider,
  setActiveSTTProvider,
  setActiveTTSProvider
};
