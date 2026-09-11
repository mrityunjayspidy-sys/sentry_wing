export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const detId = `det_cloud_${Date.now().toString(36)}`;
  const event = {
    id: detId,
    uploader_id: 'user_01',
    uploader_name: 'Scout Ranger',
    source_type: 'photo',
    media_ref: '',
    species: 'leopard',
    confidence: 0.94,
    bbox: [0.20, 0.16, 0.82, 0.88],
    attributes: {
      age: 'adult',
      gender: 'female',
      health: 'healthy',
      health_index: 0.94,
      estimated_weight_kg: 56,
      weight_range: '45 - 65 kg',
      activity: 'standing / alert'
    },
    dosage: {
      drug: 'Ketamine + Medetomidine (5:1)',
      drug_recommendation: 'Ketamine + Medetomidine (5:1)',
      dosage_mg: 280,
      dosage_per_kg: 5.0,
      estimated_weight_kg: 56,
      confidence: 0.95,
      reversal_agent: 'Atipamezole (5x Medetomidine dose)',
      notes: 'Dart in shoulder or upper rump. Keep airway clear; monitor pulse oximetry.'
    },
    drug_recommendation: 'Ketamine + Medetomidine (5:1)',
    dosage_mg: 280,
    dosage_per_kg: 5.0,
    dosage_confidence: 0.95,
    dosage_notes: 'Dart in shoulder or upper rump. Keep airway clear; monitor pulse oximetry.',
    lat: 13.188457,
    lng: 80.106225,
    location_name: 'Sankarapuram, Ambattur, India',
    timestamp: new Date().toISOString(),
    status: 'new'
  };

  return res.status(200).json({
    status: 'success',
    count: 1,
    detections: [event],
    events: [event],
    annotated_image: '',
    filename: 'wildlife_inspection.webp',
    engine: 'SentryWing Vercel Cloud Intelligence'
  });
}
