/** Demo-friendly Indian states/UTs and cities (full state list; richer city lists where demos usually run). */

export const INDIAN_STATES_AND_UTS = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

const CITIES_BY_STATE: Record<string, readonly string[]> = {
  Maharashtra: ["Pune", "Mumbai", "Nagpur", "Nashik", "Aurangabad", "Thane", "Kolhapur", "Solapur"],
  Karnataka: ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli"],
  Telangana: ["Hyderabad", "Warangal", "Nizamabad"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Noida", "Ghaziabad", "Varanasi"],
  Delhi: ["New Delhi", "Delhi"],
  "West Bengal": ["Kolkata", "Howrah", "Durgapur"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur"],
  Punjab: ["Chandigarh", "Ludhiana", "Amritsar"],
  Haryana: ["Gurugram", "Faridabad", "Panipat"],
  Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur"],
  Bihar: ["Patna", "Gaya"],
  Odisha: ["Bhubaneswar", "Cuttack"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Amaravati"],
  Goa: ["Panaji", "Margao"],
  Assam: ["Guwahati", "Dibrugarh"],
  Jharkhand: ["Ranchi", "Jamshedpur"],
  Chhattisgarh: ["Raipur", "Bhilai"],
  Uttarakhand: ["Dehradun", "Haridwar"],
  "Himachal Pradesh": ["Shimla", "Dharamshala"],
};

/** At least one city per state so the city dropdown is always usable after a state is chosen. */
const STATE_CAPITAL: Record<string, string> = {
  "Andaman and Nicobar Islands": "Port Blair",
  "Andhra Pradesh": "Amaravati",
  "Arunachal Pradesh": "Itanagar",
  Assam: "Dispur",
  Bihar: "Patna",
  Chandigarh: "Chandigarh",
  Chhattisgarh: "Raipur",
  "Dadra and Nagar Haveli and Daman and Diu": "Daman",
  Delhi: "New Delhi",
  Goa: "Panaji",
  Gujarat: "Gandhinagar",
  Haryana: "Chandigarh",
  "Himachal Pradesh": "Shimla",
  "Jammu and Kashmir": "Srinagar",
  Jharkhand: "Ranchi",
  Karnataka: "Bengaluru",
  Kerala: "Thiruvananthapuram",
  Ladakh: "Leh",
  Lakshadweep: "Kavaratti",
  "Madhya Pradesh": "Bhopal",
  Maharashtra: "Mumbai",
  Manipur: "Imphal",
  Meghalaya: "Shillong",
  Mizoram: "Aizawl",
  Nagaland: "Kohima",
  Odisha: "Bhubaneswar",
  Puducherry: "Puducherry",
  Punjab: "Chandigarh",
  Rajasthan: "Jaipur",
  Sikkim: "Gangtok",
  "Tamil Nadu": "Chennai",
  Telangana: "Hyderabad",
  Tripura: "Agartala",
  "Uttar Pradesh": "Lucknow",
  Uttarakhand: "Dehradun",
  "West Bengal": "Kolkata",
};

export function citiesForState(state: string): string[] {
  const trimmed = state.trim();
  if (!trimmed) return [];
  const listed = CITIES_BY_STATE[trimmed];
  if (listed?.length) return [...listed];
  const capital = STATE_CAPITAL[trimmed];
  return capital ? [capital] : [];
}

export function defaultCityForState(state: string): string {
  const cities = citiesForState(state);
  return cities[0] ?? "";
}
