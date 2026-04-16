const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v7: uuidv7 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// In-memory storage
const profiles = new Map();

// Helper: Determine age group
function getAgeGroup(age) {
  if (age <= 12) return 'child';
  if (age <= 19) return 'teenager';
  if (age <= 59) return 'adult';
  return 'senior';
}

// Helper: Call external APIs
async function fetchNameData(name) {
  try {
    const [genderRes, ageRes, countryRes] = await Promise.all([
      axios.get(`https://api.genderize.io?name=${encodeURIComponent(name)}`),
      axios.get(`https://api.agify.io?name=${encodeURIComponent(name)}`),
      axios.get(`https://api.nationalize.io?name=${encodeURIComponent(name)}`)
    ]);

    // Validate responses
    if (!genderRes.data.gender || genderRes.data.count === 0) {
      throw new Error('Genderize invalid response');
    }
    if (!ageRes.data.age) {
      throw new Error('Agify invalid response');
    }
    if (!countryRes.data.country || countryRes.data.country.length === 0) {
      throw new Error('Nationalize invalid response');
    }

    // Get top country
    const topCountry = countryRes.data.country.reduce((max, c) => 
      c.probability > max.probability ? c : max
    );

    return {
      gender: genderRes.data.gender,
      gender_probability: genderRes.data.probability,
      sample_size: genderRes.data.count,
      age: ageRes.data.age,
      age_group: getAgeGroup(ageRes.data.age),
      country_id: topCountry.country_id,
      country_probability: topCountry.probability
    };
  } catch (error) {
    if (error.message.includes('Genderize')) throw { api: 'Genderize' };
    if (error.message.includes('Agify')) throw { api: 'Agify' };
    if (error.message.includes('Nationalize')) throw { api: 'Nationalize' };
    throw error;
  }
}

// Endpoint 1: Create Profile
app.post('/api/profiles', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        status: 'error',
        message: 'Missing or empty name'
      });
    }

    const normalizedName = name.trim().toLowerCase();
    
    // Check for existing profile
    let existing = null;
    for (const profile of profiles.values()) {
      if (profile.name === normalizedName) {
        existing = profile;
        break;
      }
    }

    if (existing) {
      return res.status(200).json({
        status: 'success',
        message: 'Profile already exists',
        data: existing
      });
    }

    // Fetch data from APIs
    const apiData = await fetchNameData(normalizedName);

    const newProfile = {
      id: uuidv7(),
      name: normalizedName,
      ...apiData,
      created_at: new Date().toISOString()
    };

    profiles.set(newProfile.id, newProfile);

    res.status(201).json({
      status: 'success',
      data: newProfile
    });
  } catch (error) {
    if (error.api) {
      return res.status(502).json({
        status: 'error',
        message: `${error.api} returned an invalid response`
      });
    }
    console.error('Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Endpoint 2: Get Single Profile
app.get('/api/profiles/:id', (req, res) => {
  const profile = profiles.get(req.params.id);

  if (!profile) {
    return res.status(404).json({
      status: 'error',
      message: 'Profile not found'
    });
  }

  res.status(200).json({
    status: 'success',
    data: profile
  });
});

// Endpoint 3: Get All Profiles with filters
app.get('/api/profiles', (req, res) => {
  let results = Array.from(profiles.values());
  const { gender, country_id, age_group } = req.query;

  if (gender) {
    const g = gender.toLowerCase();
    results = results.filter(p => p.gender === g);
  }
  if (country_id) {
    const c = country_id.toUpperCase();
    results = results.filter(p => p.country_id === c);
  }
  if (age_group) {
    const a = age_group.toLowerCase();
    results = results.filter(p => p.age_group === a);
  }

  const data = results.map(p => ({
    id: p.id,
    name: p.name,
    gender: p.gender,
    age: p.age,
    age_group: p.age_group,
    country_id: p.country_id
  }));

  res.status(200).json({
    status: 'success',
    count: data.length,
    data
  });
});

// Endpoint 4: Delete Profile
app.delete('/api/profiles/:id', (req, res) => {
  if (!profiles.has(req.params.id)) {
    return res.status(404).json({
      status: 'error',
      message: 'Profile not found'
    });
  }

  profiles.delete(req.params.id);
  res.status(204).send();
});

// Health check endpoint (useful for Railway)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
