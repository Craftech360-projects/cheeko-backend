// Realtime voices per vendor. Mirrors main/python-agent/agent/realtime.py.
window.REALTIME_VOICES = {
  openai: ['beacon', 'cinder', 'marin', 'stone', 'vesper'],
  google: ['Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 'Callirrhoe', 'Charon', 'Despina',
    'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Pulcherrima', 'Puck',
    'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi'],
  xai: ['carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith', 'perseus', 'helios', 'lux', 'kepler',
    'rigel', 'cosmo', 'celeste', 'ursa', 'sirius', 'lumen', 'castor', 'naksh', 'atlas', 'ara', 'eve', 'leo', 'rex', 'sal'],
};

// Seeded realtime provider rows (manager migration 20260915000000) and their vendor.
window.REALTIME_PROVIDERS = {
  'openai-gpt-live': 'openai',
  'google-gemini-live': 'google',
  'xai-grok-voice': 'xai',
};

// Fill a <select> with a vendor's voices; the empty option means "use the default".
window.fillVoiceSelect = function fillVoiceSelect(select, vendor, defaultLabel) {
  const keep = select.value;
  select.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = defaultLabel;
  select.appendChild(def);
  (window.REALTIME_VOICES[vendor] || []).forEach((voice) => {
    const o = document.createElement('option');
    o.value = voice;
    o.textContent = voice;
    select.appendChild(o);
  });
  select.value = [...select.options].some((o) => o.value === keep) ? keep : '';
};

document.querySelectorAll('select[data-voices]').forEach((select) => {
  window.fillVoiceSelect(select, select.dataset.voices, select.dataset.defaultLabel || 'Default');
});
