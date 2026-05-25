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
      language: stt.language || ''
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
  getActiveProviders,
  setActiveLLMProvider,
  setActiveSTTProvider,
  setActiveTTSProvider
};
