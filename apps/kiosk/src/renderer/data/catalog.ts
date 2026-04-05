// ─── Catalog types ────────────────────────────────────────────────────────────
export interface CatalogItem {
  id: string
  name: string
  nameGu: string
  nameHi: string
  icon: string
  emoji: string
  price: number
  category: string
  giftAidEligible: boolean
  description: string
  unit?: string
  imageColor: string
  image?: string   // stable Unsplash product photo URL
  /** ISO date string (YYYY-MM-DD). Item is available on or after this date. */
  startDate?: string
  /** ISO date string (YYYY-MM-DD). Item is unavailable after this date. If unset, no end restriction. */
  endDate?: string
}

/**
 * Returns true if the item is currently available based on its startDate / endDate.
 * If neither is set, the item is always available.
 */
export function isItemActive(item: CatalogItem, today = new Date()): boolean {
  const todayStr = today.toISOString().slice(0, 10)
  if (item.startDate && todayStr < item.startDate) return false
  if (item.endDate   && todayStr > item.endDate)   return false
  return true
}

/** Filter a catalog array to only currently-active items. */
export function filterActiveItems(items: CatalogItem[]): CatalogItem[] {
  return items.filter(item => isItemActive(item))
}

export interface ProjectInfo {
  id: string
  name: string
  nameGu: string
  goal: number
  raised: number
  emoji: string
  description?: string
}

// ─── Soft Donation Items (physical food — NOT gift aid) ───────────────────────
export const SOFT_DONATION_ITEMS: CatalogItem[] = [
  // Grains
  { id: 'rice_10',  name: 'Rice Bag 10kg',          nameGu: 'ચોખા 10kg',        nameHi: 'चावल 10kg',       icon: '🌾', emoji: '🌾', price: 15, category: 'GRAINS', giftAidEligible: true, description: 'White rice bag 10kg',           unit: '10kg',   imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=250&fit=crop&q=80' },
  { id: 'rice_25',  name: 'Rice Bag 25kg',          nameGu: 'ચોખા 25kg',        nameHi: 'चावल 25kg',       icon: '🌾', emoji: '🌾', price: 35, category: 'GRAINS', giftAidEligible: true, description: 'White rice bag 25kg',           unit: '25kg',   imageColor: '#FDE68A', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=250&fit=crop&q=80' },
  { id: 'basmati_5',name: 'Basmati Rice 5kg',       nameGu: 'બાસમતી 5kg',       nameHi: 'बासमती 5kg',      icon: '🌾', emoji: '🌾', price: 18, category: 'GRAINS', giftAidEligible: true, description: 'Premium basmati rice 5kg',       unit: '5kg',    imageColor: '#FEF9C3', image: 'https://images.unsplash.com/photo-1536304993881-ff86d42818ef?w=400&h=250&fit=crop&q=80' },
  { id: 'atta_10',  name: 'Atta (Wheat Flour) 10kg',nameGu: 'આટો 10kg',         nameHi: 'आटा 10kg',        icon: '🌿', emoji: '🌿', price: 12, category: 'GRAINS', giftAidEligible: true, description: 'Chapati flour 10kg',            unit: '10kg',   imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1588072432836-e10032774350?w=400&h=250&fit=crop&q=80' },
  { id: 'atta_20',  name: 'Atta 20kg',              nameGu: 'આટો 20kg',         nameHi: 'आटा 20kg',        icon: '🌿', emoji: '🌿', price: 22, category: 'GRAINS', giftAidEligible: true, description: 'Chapati flour 20kg',            unit: '20kg',   imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1588072432836-e10032774350?w=400&h=250&fit=crop&q=80' },
  // Oil & Essentials
  { id: 'sunflower_5l',  name: 'Sunflower Oil 5L',      nameGu: 'સૂર્યમુખી તેલ 5L', nameHi: 'सूरजमुखी तेल 5L', icon: '🌻', emoji: '🌻', price: 8,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Pure sunflower oil 5 litres',     unit: '5L',     imageColor: '#FEF08A', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=250&fit=crop&q=80' },
  { id: 'mustard_5l',    name: 'Mustard Oil 5L',        nameGu: 'સરસવ તેલ 5L',     nameHi: 'सरसों का तेल 5L',  icon: '🌼', emoji: '🌼', price: 9,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Pure mustard oil 5 litres',       unit: '5L',     imageColor: '#FEF08A', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=250&fit=crop&q=80' },
  { id: 'sugar_5',       name: 'Sugar 5kg',             nameGu: 'ખાંડ 5kg',         nameHi: 'चीनी 5kg',        icon: '🍬', emoji: '🍬', price: 6,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'White granulated sugar 5kg',     unit: '5kg',    imageColor: '#F9FAFB', image: 'https://images.unsplash.com/photo-1559181567-c3190ca9959b?w=400&h=250&fit=crop&q=80' },
  { id: 'salt_2',        name: 'Salt 2kg',              nameGu: 'મીઠું 2kg',        nameHi: 'नमक 2kg',          icon: '🧂', emoji: '🧂', price: 2,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Table salt 2kg',                unit: '2kg',    imageColor: '#F3F4F6', image: 'https://images.unsplash.com/photo-1596097635121-14b63b7a0c19?w=400&h=250&fit=crop&q=80' },
  { id: 'tea_500',       name: 'Tea (Loose) 500g',      nameGu: 'ચા 500g',          nameHi: 'चाय 500g',         icon: '🍵', emoji: '🍵', price: 5,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Loose leaf tea 500g',            unit: '500g',   imageColor: '#D6B27040', image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=250&fit=crop&q=80' },
  { id: 'biscuits',      name: 'Biscuits (Assorted)',   nameGu: 'બિસ્કિટ',          nameHi: 'बिस्कुट',          icon: '🍪', emoji: '🍪', price: 4,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Assorted biscuit pack',          unit: 'pack',   imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&h=250&fit=crop&q=80' },
  { id: 'milk_powder',   name: 'Milk Powder 400g',      nameGu: 'દૂધ પાવડર',        nameHi: 'दूध पाउडर',        icon: '🥛', emoji: '🥛', price: 7,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Full fat milk powder 400g',      unit: '400g',   imageColor: '#EFF6FF', image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&h=250&fit=crop&q=80' },
  { id: 'tinned_tomatoes',name:'Tinned Tomatoes (6 pack)',nameGu:'ટિન ટામેટા',      nameHi: 'टिन टमाटर',       icon: '🍅', emoji: '🍅', price: 5,  category: 'OIL_ESSENTIALS', giftAidEligible: true, description: 'Chopped tinned tomatoes 6 pack', unit: '6 pack', imageColor: '#FEE2E2', image: 'https://images.unsplash.com/photo-1546548970-71785318a17b?w=400&h=250&fit=crop&q=80' },
  // Pulses
  { id: 'chana_5',  name: 'Chana Daal 5kg',  nameGu: 'ચણા દાળ 5kg',  nameHi: 'चना दाल 5kg',   icon: '🫘', emoji: '🫘', price: 10, category: 'PULSES', giftAidEligible: true, description: 'Split chana daal 5kg',  unit: '5kg', imageColor: '#FEF9C3', image: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80' },
  { id: 'toor_5',   name: 'Toor Daal 5kg',   nameGu: 'તુવેર દાળ 5kg', nameHi: 'तुअर दाल 5kg',  icon: '🫘', emoji: '🫘', price: 12, category: 'PULSES', giftAidEligible: true, description: 'Split toor daal 5kg',   unit: '5kg', imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80' },
  { id: 'masoor_5', name: 'Masoor Daal 5kg', nameGu: 'મસૂર દાળ 5kg',  nameHi: 'मसूर दाल 5kg',  icon: '🫘', emoji: '🫘', price: 9,  category: 'PULSES', giftAidEligible: true, description: 'Red lentils 5kg',       unit: '5kg', imageColor: '#FED7AA', image: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80' },
  { id: 'urad_5',   name: 'Urad Daal 5kg',   nameGu: 'અડદ દાળ 5kg',   nameHi: 'उड़द दाल 5kg',  icon: '🫘', emoji: '🫘', price: 11, category: 'PULSES', giftAidEligible: true, description: 'Split black urad daal 5kg',unit:'5kg', imageColor: '#E5E7EB', image: 'https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=400&h=250&fit=crop&q=80' },
]

// ─── Brick Tiers for Project Donations (gift aid eligible) ────────────────────
export const BRICK_TIERS: CatalogItem[] = [
  { id: 'brick_red',      name: 'Red Brick',      nameGu: 'લાલ ઈંટ',       nameHi: 'लाल ईंट',       icon: '🧱', emoji: '🧱', price: 1,   category: 'PROJECT_DONATION', giftAidEligible: true, description: 'Every penny counts towards our temple', imageColor: '#EF4444', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
  { id: 'brick_bronze',   name: 'Bronze Brick',   nameGu: 'કાંસ્ય ઈંટ',   nameHi: 'कांस्य ईंट',   icon: '🧱', emoji: '🧱', price: 5,   category: 'PROJECT_DONATION', giftAidEligible: true, description: 'Help lay the foundations',                imageColor: '#D97706', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
  { id: 'brick_silver',   name: 'Silver Brick',   nameGu: 'ચાંદી ઈંટ',    nameHi: 'चांदी ईंट',    icon: '🧱', emoji: '🧱', price: 11,  category: 'PROJECT_DONATION', giftAidEligible: true, description: 'Build the walls of our community',       imageColor: '#6B7280', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
  { id: 'brick_gold',     name: 'Gold Brick',     nameGu: 'સોના ઈંટ',     nameHi: 'सोना ईंट',     icon: '🧱', emoji: '🧱', price: 51,  category: 'PROJECT_DONATION', giftAidEligible: true, description: 'A golden contribution to our temple',    imageColor: '#F59E0B', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
  { id: 'brick_platinum', name: 'Platinum Brick', nameGu: 'પ્લૈટિનમ ઈંટ', nameHi: 'प्लेटिनम ईंट', icon: '🧱', emoji: '🧱', price: 101, category: 'PROJECT_DONATION', giftAidEligible: true, description: 'Platinum patron of our sacred building',  imageColor: '#06B6D4', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
  { id: 'brick_diamond',  name: 'Diamond Brick',  nameGu: 'હીરા ઈંટ',     nameHi: 'हीरा ईंट',     icon: '💎', emoji: '💎', price: 251, category: 'PROJECT_DONATION', giftAidEligible: true, description: 'Diamond sponsor — your legacy endures',  imageColor: '#8B5CF6', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
  { id: 'brick_shree',    name: 'Shree Brick',    nameGu: 'શ્રી ઈંટ',     nameHi: 'श्री ईंट',     icon: '🕉️', emoji: '🕉️', price: 501, category: 'PROJECT_DONATION', giftAidEligible: true, description: 'The highest honour — blessed by Sri',    imageColor: '#EC4899', image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&h=250&fit=crop&q=80' },
]

// ─── Projects ─────────────────────────────────────────────────────────────────
export const PROJECTS: ProjectInfo[] = [
  { id: 'temple_ext', name: 'Temple Extension', nameGu: 'મંદિર વિસ્તાર', goal: 500000, raised: 187000, emoji: '🛕', description: 'Expand the main temple hall to accommodate more worshippers' },
  { id: 'kitchen', name: 'New Community Kitchen', nameGu: 'નવી રસોઈ', goal: 75000, raised: 42000, emoji: '👨‍🍳', description: 'A modern kitchen to serve langar and community meals' },
  { id: 'education', name: "Children's Education Centre", nameGu: 'બાળ શિક્ષણ', goal: 120000, raised: 31500, emoji: '📚', description: 'Dedicated space for Bal Vihar and cultural education' },
  { id: 'hall_reno', name: 'Community Hall Renovation', nameGu: 'હૉલ નવીનીકરણ', goal: 95000, raised: 67000, emoji: '🏛️', description: 'Modernise the community hall for events and gatherings' },
  { id: 'heritage', name: 'Heritage Conservation', nameGu: 'ઐતિહ્ય', goal: 200000, raised: 15000, emoji: '🏺', description: 'Preserve and restore heritage artworks and sculptures' },
]

// ─── Shop Items (NOT gift aid) ────────────────────────────────────────────────
export const SHOP_ITEMS: CatalogItem[] = [
  // Puja items
  { id: 'coconut_sm',        name: 'Coconut (small)',      nameGu: 'નારિયળ (નાનો)',          nameHi: 'नारियल (छोटा)',      icon: '🥥', emoji: '🥥', price: 1,  category: 'PUJA_ITEMS',       giftAidEligible: false, description: 'Small fresh coconut for puja',       imageColor: '#D1FAE5', image: 'https://images.unsplash.com/photo-1580984969071-a8da5656c2fb?w=400&h=250&fit=crop&q=80' },
  { id: 'coconut_lg',        name: 'Coconut (large)',      nameGu: 'નારિયળ (મોટો)',          nameHi: 'नारियल (बड़ा)',      icon: '🥥', emoji: '🥥', price: 2,  category: 'PUJA_ITEMS',       giftAidEligible: false, description: 'Large fresh coconut for puja',       imageColor: '#A7F3D0', image: 'https://images.unsplash.com/photo-1580984969071-a8da5656c2fb?w=400&h=250&fit=crop&q=80' },
  { id: 'incense_pack',      name: 'Incense Sticks Pack',  nameGu: 'અગરબત્તી',               nameHi: 'अगरबत्ती',          icon: '🕯️', emoji: '🕯️', price: 3, category: 'PUJA_ITEMS',       giftAidEligible: false, description: 'Pack of mixed incense sticks',       imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1601315377985-f4e2a08bf4a0?w=400&h=250&fit=crop&q=80' },
  { id: 'premium_agarbatti', name: 'Premium Agarbatti',    nameGu: 'ઉત્કૃષ્ટ અગરબત્તી',     nameHi: 'प्रीमियम अगरबत्ती', icon: '🕯️', emoji: '🕯️', price: 5, category: 'PUJA_ITEMS',       giftAidEligible: false, description: 'Premium quality incense sticks',     imageColor: '#FDE68A', image: 'https://images.unsplash.com/photo-1601315377985-f4e2a08bf4a0?w=400&h=250&fit=crop&q=80' },
  { id: 'camphor',           name: 'Camphor Tabs',         nameGu: 'કાફૂર',                  nameHi: 'कपूर',              icon: '⬜', emoji: '⬜', price: 2,  category: 'PUJA_ITEMS',       giftAidEligible: false, description: 'Pure camphor tablets for aarti',     imageColor: '#F1F5F9', image: 'https://images.unsplash.com/photo-1599940824399-b87987ceb72a?w=400&h=250&fit=crop&q=80' },
  { id: 'prasad_box',        name: 'Prasad Box (assorted)',nameGu: 'પ્રસાદ',                 nameHi: 'प्रसाद',             icon: '🍮', emoji: '🍮', price: 5,  category: 'PRASAD',           giftAidEligible: false, description: 'Assorted prasad box',                imageColor: '#FEF9C3', image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=250&fit=crop&q=80' },
  { id: 'modak_6',           name: 'Modak (6 pcs)',        nameGu: 'મોદક',                   nameHi: 'मोदक',              icon: '🍡', emoji: '🍡', price: 4,  category: 'PRASAD',           giftAidEligible: false, description: 'Sweet modak — 6 pieces',             imageColor: '#FCE7F3', image: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&h=250&fit=crop&q=80' },
  // Books
  { id: 'gita_en',           name: 'Bhagavad Gita (English)',  nameGu: 'ભગવદ ગીતા (અંગ્રેજી)',  nameHi: 'भगवद गीता (अंग्रेजी)',  icon: '📖', emoji: '📖', price: 8,  category: 'BOOKS', giftAidEligible: false, description: 'Bhagavad Gita in English',  imageColor: '#EFF6FF', image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=250&fit=crop&q=80' },
  { id: 'gita_gu',           name: 'Bhagavad Gita (Gujarati)', nameGu: 'ભગવદ ગીતા (ગુજરાતી)', nameHi: 'भगवद गीता (गुजराती)', icon: '📖', emoji: '📖', price: 9,  category: 'BOOKS', giftAidEligible: false, description: 'Bhagavad Gita in Gujarati', imageColor: '#EFF6FF', image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=250&fit=crop&q=80' },
  { id: 'ramayana',          name: 'Ramayana',                 nameGu: 'રામાયણ',               nameHi: 'रामायण',              icon: '📜', emoji: '📜', price: 10, category: 'BOOKS', giftAidEligible: false, description: 'The Ramayana scripture',    imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=250&fit=crop&q=80' },
  { id: 'hanuman_chalisa',   name: 'Hanuman Chalisa',          nameGu: 'હનુમાન ચાલીસા',       nameHi: 'हनुमान चालीसा',       icon: '📜', emoji: '📜', price: 3,  category: 'BOOKS', giftAidEligible: false, description: 'Hanuman Chalisa prayer book',imageColor: '#FEE2E2', image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=250&fit=crop&q=80' },
  // Murtis
  { id: 'ganesh_sm',     name: 'Ganesh Murti (small)', nameGu: 'ગણેશ મૂર્તિ',  nameHi: 'गणेश मूर्ति',  icon: '🐘', emoji: '🐘', price: 15, category: 'MURTIS', giftAidEligible: false, description: 'Small Ganesh murti for home',    imageColor: '#FFF7ED', image: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&h=250&fit=crop&q=80' },
  { id: 'lakshmi_murti', name: 'Lakshmi Murti',        nameGu: 'લક્ષ્મી મૂર્તિ',nameHi: 'लक्ष्मी मूर्ति',icon: '🪷', emoji: '🪷', price: 20, category: 'MURTIS', giftAidEligible: false, description: 'Lakshmi murti for prosperity',   imageColor: '#FEF9C3', image: 'https://images.unsplash.com/photo-1532634896-26909d0d4b00?w=400&h=250&fit=crop&q=80' },
  { id: 'radha_krishna', name: 'Radha-Krishna Murti',  nameGu: 'રાધા-કૃષ્ણ',   nameHi: 'राधा-कृष्ण',   icon: '🫶', emoji: '🫶', price: 25, category: 'MURTIS', giftAidEligible: false, description: 'Radha-Krishna murti set',        imageColor: '#EDE9FE', image: 'https://images.unsplash.com/photo-1564507592333-c60657eea523?w=400&h=250&fit=crop&q=80' },
  // Malas
  { id: 'rudraksha_mala', name: 'Rudraksha Mala (108)', nameGu: 'રુદ્રાક્ષ માળા', nameHi: 'रुद्राक्ष माला',  icon: '📿', emoji: '📿', price: 12, category: 'MALAS', giftAidEligible: false, description: '108 bead rudraksha mala',     imageColor: '#D6B270', image: 'https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?w=400&h=250&fit=crop&q=80' },
  { id: 'crystal_mala',   name: 'Crystal Mala',         nameGu: 'ક્રિસ્ટલ માળા',  nameHi: 'क्रिस्टल माला',  icon: '📿', emoji: '📿', price: 8,  category: 'MALAS', giftAidEligible: false, description: 'Clear crystal prayer mala',   imageColor: '#E0F2FE', image: 'https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?w=400&h=250&fit=crop&q=80' },
  // Puja accessories
  { id: 'puja_thali', name: 'Puja Thali Set',   nameGu: 'પૂજા થાળ',    nameHi: 'पूजा थाल', icon: '🥘', emoji: '🥘', price: 18, category: 'PUJA_ACCESSORIES', giftAidEligible: false, description: 'Complete puja thali set', imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=400&h=250&fit=crop&q=80' },
  { id: 'kalash',     name: 'Kalash',           nameGu: 'કળશ',         nameHi: 'कलश',       icon: '🏺', emoji: '🏺', price: 10, category: 'PUJA_ACCESSORIES', giftAidEligible: false, description: 'Sacred water pot',         imageColor: '#FDE68A', image: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=250&fit=crop&q=80' },
  { id: 'sindoor',    name: 'Sindoor',          nameGu: 'સિંદૂર',      nameHi: 'सिंदूर',    icon: '🔴', emoji: '🔴', price: 3,  category: 'PUJA_ACCESSORIES', giftAidEligible: false, description: 'Vermilion powder',         imageColor: '#FEE2E2', image: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=400&h=250&fit=crop&q=80' },
  { id: 'kumkum',     name: 'Kumkum',           nameGu: 'કુમકુમ',      nameHi: 'कुमकुम',    icon: '🔴', emoji: '🔴', price: 2,  category: 'PUJA_ACCESSORIES', giftAidEligible: false, description: 'Sacred kumkum powder',     imageColor: '#FECACA', image: 'https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=400&h=250&fit=crop&q=80' },
  { id: 'diya_clay',  name: 'Diya (clay, 12pk)',nameGu: 'દીવો',        nameHi: 'दिया',      icon: '🪔', emoji: '🪔', price: 4,  category: 'PUJA_ACCESSORIES', giftAidEligible: false, description: 'Clay diya 12 pack',        imageColor: '#FEF3C7', image: 'https://images.unsplash.com/photo-1604431696980-07b4a3e01379?w=400&h=250&fit=crop&q=80' },
  { id: 'diya_brass', name: 'Brass Diya',       nameGu: 'પિત્તળ દીવો', nameHi: 'पीतल दिया', icon: '🪔', emoji: '🪔', price: 8,  category: 'PUJA_ACCESSORIES', giftAidEligible: false, description: 'Premium brass diya',       imageColor: '#FDE68A', image: 'https://images.unsplash.com/photo-1604431696980-07b4a3e01379?w=400&h=250&fit=crop&q=80' },
]

// ─── General Donations (gift aid eligible) ────────────────────────────────────
export const GENERAL_DONATIONS: CatalogItem[] = [
  { id: 'gen_1', name: 'Test Donation £1', nameGu: 'પરીક્ષણ દાન £1', nameHi: 'परीक्षण दान £1', icon: '🧪', emoji: '🧪', price: 1, category: 'GENERAL_DONATION', giftAidEligible: false, description: 'Test payment — £1', imageColor: '#EFF6FF', image: 'https://images.unsplash.com/photo-1532629345422-7515f3d16bb6?w=400&h=250&fit=crop&q=80' },
  { id: 'gen_5', name: 'General Donation £5', nameGu: 'સામાન્ય દાન £5', nameHi: 'सामान्य दान £5', icon: '🙏', emoji: '🙏', price: 5, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'General donation to the temple', imageColor: '#FEF3C7' },
  { id: 'gen_10', name: 'General Donation £10', nameGu: 'સામાન્ય દાન £10', nameHi: 'सामान्य दान £10', icon: '🙏', emoji: '🙏', price: 10, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'General donation to the temple', imageColor: '#FEF3C7' },
  { id: 'gen_25', name: 'General Donation £25', nameGu: 'સામાન્ય દાન £25', nameHi: 'सामान्य दान £25', icon: '🙏', emoji: '🙏', price: 25, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'General donation to the temple', imageColor: '#FDE68A' },
  { id: 'gen_50', name: 'General Donation £50', nameGu: 'સામાન્ય દાન £50', nameHi: 'सामान्य दान £50', icon: '🙏', emoji: '🙏', price: 50, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'General donation to the temple', imageColor: '#FDE68A' },
  { id: 'gen_100', name: 'General Donation £100', nameGu: 'સામાન્ય દાન £100', nameHi: 'सामान्य दान £100', icon: '🙏', emoji: '🙏', price: 100, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'General donation to the temple', imageColor: '#F59E0B' },
  { id: 'gen_250', name: 'General Donation £250', nameGu: 'સામાન્ય દાન £250', nameHi: 'सामान्य दान £250', icon: '🙏', emoji: '🙏', price: 250, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'General donation to the temple', imageColor: '#D97706' },
  { id: 'gau_11', name: 'Gau Seva (Cow Care) £11', nameGu: 'ગૌ સેવા £11', nameHi: 'गौ सेवा £11', icon: '🐄', emoji: '🐄', price: 11, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'Sponsor care for sacred cows', imageColor: '#D1FAE5' },
  { id: 'gau_21', name: 'Gau Seva (Cow Care) £21', nameGu: 'ગૌ સેવા £21', nameHi: 'गौ सेवा £21', icon: '🐄', emoji: '🐄', price: 21, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'Sponsor care for sacred cows', imageColor: '#A7F3D0' },
  { id: 'anna_11', name: 'Anna Daan £11', nameGu: 'અન્ન દાન £11', nameHi: 'अन्न दान £11', icon: '🍛', emoji: '🍛', price: 11, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'Food for all — anna daan', imageColor: '#FEF9C3' },
  { id: 'anna_21', name: 'Anna Daan £21', nameGu: 'અન્ન દાન £21', nameHi: 'अन्न दान £21', icon: '🍛', emoji: '🍛', price: 21, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'Food for all — anna daan', imageColor: '#FEF3C7' },
  { id: 'anna_51', name: 'Anna Daan £51', nameGu: 'અન્ન દાન £51', nameHi: 'अन्न दान £51', icon: '🍛', emoji: '🍛', price: 51, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'Food for all — anna daan', imageColor: '#FDE68A' },
  { id: 'lamp_month', name: 'Lamp Sponsorship £11/month', nameGu: 'દીપ પ્રાયોજન', nameHi: 'दीपक प्रायोजन', icon: '🪔', emoji: '🪔', price: 11, category: 'GENERAL_DONATION', giftAidEligible: true, description: 'Sponsor a lamp in the temple — monthly', unit: '/month', imageColor: '#FEF9C3' },
]

// ─── Temple Sponsorship Items (from shirdisai.org.uk) ─────────────────────────
// Physical temple item sponsorships — NOT gift aid eligible (goods/services received)
export const SPONSORSHIP_ITEMS: CatalogItem[] = [
  // Satcharitra Books
  { id: 'book_11',   name: 'Satcharitra Books (11)', nameGu: 'સતચરિત્ર ૧૧ પ્રત', nameHi: 'सतचरित्र 11 प्रतियां', icon: '📖', emoji: '📖', price: 21,   category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor 11 Shri Sai Satcharitra books', unit: '11 books', imageColor: '#FDE68A' },
  { id: 'book_51',   name: 'Satcharitra Books (51)', nameGu: 'સતચરિત્ર ૫૧ પ્રત', nameHi: 'सतचरित्र 51 प्रतियां', icon: '📖', emoji: '📖', price: 101,  category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor 51 Sai Satcharitra books', unit: '51 books', imageColor: '#F59E0B' },
  { id: 'book_101',  name: 'Satcharitra Books (101)', nameGu: 'સતચરિત્ર ૧૦૧ પ્રત', nameHi: 'सतचरित्र 101 प्रतियां', icon: '📖', emoji: '📖', price: 201,  category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor 101 Sai Satcharitra books', unit: '101 books', imageColor: '#D97706' },
  { id: 'book_501',  name: 'Satcharitra Books (501)', nameGu: 'સતચરિત્ર ૫૦૧ પ્રત', nameHi: 'सतचरित्र 501 प्रतियां', icon: '📖', emoji: '📖', price: 1001, category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor 501 Sai Satcharitra books', unit: '501 books', imageColor: '#B45309' },
  { id: 'book_1001', name: 'Satcharitra Books (1001)', nameGu: 'સતચરિત્ર ૧૦૦૧ પ્રત', nameHi: 'सतचरित्र 1001 प्रतियां', icon: '📖', emoji: '📖', price: 2001, category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor 1001 Sai Satcharitra books', unit: '1001 books', imageColor: '#92400E' },
  // Baba's Shawls
  { id: 'shawl_day',   name: "Baba's Shawl (1 Day)",   nameGu: 'બાબાની ચાદર (1 દિવસ)', nameHi: 'बाबा का शॉल (1 दिन)', icon: '🧣', emoji: '🧣', price: 41,  category: 'SPONSORSHIP', giftAidEligible: false, description: "Sponsor Baba's shawl for one day", unit: '1 day', imageColor: '#E0E7FF' },
  { id: 'shawl_week',  name: "Baba's Shawl (1 Week)",  nameGu: 'બાબાની ચાદર (1 અઠવ)', nameHi: 'बाबा का शॉल (1 सप्ताह)', icon: '🧣', emoji: '🧣', price: 151, category: 'SPONSORSHIP', giftAidEligible: false, description: "Sponsor Baba's shawl for one week", unit: '1 week', imageColor: '#C7D2FE' },
  { id: 'shawl_fortnight', name: "Baba's Shawl (Fortnight)", nameGu: 'ચાદર (2 અઠવ)', nameHi: 'बाबा का शॉल (2 सप्ताह)', icon: '🧣', emoji: '🧣', price: 251, category: 'SPONSORSHIP', giftAidEligible: false, description: "Sponsor Baba's shawl for a fortnight", unit: '2 weeks', imageColor: '#A5B4FC' },
  { id: 'shawl_month', name: "Baba's Shawl (1 Month)", nameGu: 'ચાદર (1 મહિનો)', nameHi: 'बाबा का शॉल (1 महीना)', icon: '🧣', emoji: '🧣', price: 651, category: 'SPONSORSHIP', giftAidEligible: false, description: "Sponsor Baba's shawl for one month", unit: '1 month', imageColor: '#818CF8' },
  // Flower Garlands
  { id: 'garland_day',   name: 'Flower Garland (1 Day)',   nameGu: 'ફૂલ માળા (1 દિવસ)', nameHi: 'फूल माला (1 दिन)', icon: '💐', emoji: '💐', price: 21,  category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor flower garlands for one day', unit: '1 day', imageColor: '#FCE7F3' },
  { id: 'garland_week',  name: 'Flower Garland (1 Week)',  nameGu: 'ફૂલ માળા (1 અઠવ)', nameHi: 'फूल माला (1 सप्ताह)', icon: '💐', emoji: '💐', price: 101, category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor flower garlands for one week', unit: '1 week', imageColor: '#FBCFE8' },
  { id: 'garland_fortnight', name: 'Flower Garland (Fortnight)', nameGu: 'ફૂલ માળા (2 અઠવ)', nameHi: 'फूल माला (2 सप्ताह)', icon: '💐', emoji: '💐', price: 201, category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor flower garlands for a fortnight', unit: '2 weeks', imageColor: '#F9A8D4' },
  { id: 'garland_month', name: 'Flower Garland (1 Month)', nameGu: 'ફૂલ માળા (1 મહિનો)', nameHi: 'फूल माला (1 महीना)', icon: '💐', emoji: '💐', price: 651, category: 'SPONSORSHIP', giftAidEligible: false, description: 'Sponsor flower garlands for a full month', unit: '1 month', imageColor: '#EC4899' },
]

// ─── Combined catalog ─────────────────────────────────────────────────────────
export const ALL_CATALOG_ITEMS: CatalogItem[] = [
  ...SOFT_DONATION_ITEMS,
  ...BRICK_TIERS,
  ...SHOP_ITEMS,
  ...GENERAL_DONATIONS,
  ...SPONSORSHIP_ITEMS,
]
