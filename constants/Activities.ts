
export interface Activity {
  id: string;
  label: string;
  icon: string; // FontAwesome icon name
  popular?: boolean;
}

export const ACTIVITIES: Activity[] = [
  // Populaire (mis en avant)
  { id: 'nightclub', label: 'Boîte de nuit', icon: 'music', popular: true },
  { id: 'bar', label: 'Bar', icon: 'glass', popular: true },
  { id: 'camping', label: 'Camping', icon: 'fire', popular: true },
  { id: 'festival', label: 'Festival', icon: 'ticket', popular: true },
  { id: 'concert', label: 'Concert', icon: 'headphones', popular: true },
  { id: 'sport', label: 'Sport', icon: 'soccer-ball-o', popular: true },
  { id: 'travel', label: 'Voyage', icon: 'plane', popular: true },
  { id: 'beach', label: 'Plage', icon: 'sun-o', popular: true },
  { id: 'cinema', label: 'Cinéma', icon: 'film', popular: true },
  { id: 'restaurant', label: 'Restaurant', icon: 'cutlery', popular: true },
  { id: 'gaming', label: 'Jeux vidéo', icon: 'gamepad', popular: true },
  { id: 'shopping', label: 'Shopping', icon: 'shopping-bag', popular: true },
  { id: 'hiking', label: 'Randonnée', icon: 'tree', popular: true },

  // Autres activités
  { id: 'petanque', label: 'Pétanque', icon: 'circle-o' },
  { id: 'knitting', label: 'Tricot', icon: 'scissors' }, // scissors as closest match or maybe generic circle
  { id: 'reading', label: 'Lecture', icon: 'book' },
  { id: 'cooking', label: 'Cuisine', icon: 'spoon' },
  { id: 'photography', label: 'Photographie', icon: 'camera' },
  { id: 'dancing', label: 'Danse', icon: 'heart' }, // heart for passion/dance
  { id: 'yoga', label: 'Yoga', icon: 'heartbeat' },
  { id: 'fitness', label: 'Musculation', icon: 'anchor' }, // anchor for heavy lifting? or generic
  { id: 'football', label: 'Football', icon: 'soccer-ball-o' },
  { id: 'basketball', label: 'Basketball', icon: 'dribbble' },
  { id: 'tennis', label: 'Tennis', icon: 'circle' },
  { id: 'swimming', label: 'Natation', icon: 'tint' },
  { id: 'running', label: 'Course à pied', icon: 'road' },
  { id: 'cycling', label: 'Vélo', icon: 'bicycle' },
  { id: 'music_playing', label: 'Musique (jouer)', icon: 'music' },
  { id: 'painting', label: 'Peinture', icon: 'paint-brush' },
  { id: 'drawing', label: 'Dessin', icon: 'pencil' },
  { id: 'theater', label: 'Théâtre', icon: 'star' },
  { id: 'writing', label: 'Écriture', icon: 'pencil-square-o' },
  { id: 'gardening', label: 'Jardinage', icon: 'leaf' },
  { id: 'diy', label: 'Bricolage', icon: 'wrench' },
  { id: 'fashion', label: 'Mode', icon: 'shopping-bag' },
  { id: 'beauty', label: 'Beauté', icon: 'star-o' },
  { id: 'animals', label: 'Animaux', icon: 'paw' },
  { id: 'politics', label: 'Politique', icon: 'gavel' },
  { id: 'history', label: 'Histoire', icon: 'hourglass' },
  { id: 'science', label: 'Sciences', icon: 'flask' },
  { id: 'technology', label: 'Technologie', icon: 'laptop' },
  { id: 'cars', label: 'Automobile', icon: 'car' },
  { id: 'motorcycles', label: 'Moto', icon: 'motorcycle' },
  { id: 'board_games', label: 'Jeux de société', icon: 'puzzle-piece' },
  { id: 'volunteering', label: 'Bénévolat', icon: 'handshake-o' },
  { id: 'meditation', label: 'Méditation', icon: 'smile-o' },
  { id: 'fishing', label: 'Pêche', icon: 'ship' },
  { id: 'skiing', label: 'Ski', icon: 'snowflake-o' },
  { id: 'surfing', label: 'Surf', icon: 'tint' }, // tint/water related
  { id: 'climbing', label: 'Escalade', icon: 'arrow-up' },
  { id: 'astrology', label: 'Astrologie', icon: 'star' },
  { id: 'spirituality', label: 'Spiritualité', icon: 'eye' },
  { id: 'investing', label: 'Investissement', icon: 'money' },
  { id: 'entrepreneurship', label: 'Entrepreneuriat', icon: 'briefcase' },
  { id: 'languages', label: 'Langues', icon: 'comment-o' },
  { id: 'museums', label: 'Musées', icon: 'building' },
  { id: 'coffee', label: 'Café', icon: 'coffee' },
  { id: 'wine', label: 'Vin', icon: 'glass' },
  { id: 'beer', label: 'Bière', icon: 'beer' },
  { id: 'comics', label: 'BD / Mangas', icon: 'book' },
  { id: 'anime', label: 'Anime', icon: 'television' },
  { id: 'cosplay', label: 'Cosplay', icon: 'user-circle-o' },
  { id: 'magic', label: 'Magie', icon: 'magic' },
  { id: 'standup', label: 'Stand-up', icon: 'microphone' },
  { id: 'esports', label: 'E-sport', icon: 'gamepad' },
  { id: 'crypto', label: 'Crypto', icon: 'btc' },
  { id: 'nfts', label: 'NFTs', icon: 'picture-o' },
  { id: 'virtual_reality', label: 'Réalité Virtuelle', icon: 'eye' },
  { id: 'environment', label: 'Écologie', icon: 'recycle' },
  { id: 'human_rights', label: 'Droits de l\'homme', icon: 'globe' },
  { id: 'feminism', label: 'Féminisme', icon: 'female' },
  { id: 'lgbtq', label: 'LGBTQ+', icon: 'transgender' }, // close enough
  { id: 'singing', label: 'Chant', icon: 'microphone' },
  { id: 'karaoke', label: 'Karaoké', icon: 'microphone' },
  { id: 'boxing', label: 'Boxe', icon: 'hand-rock-o' },
  { id: 'martial_arts', label: 'Arts martiaux', icon: 'hand-rock-o' },
  { id: 'skating', label: 'Skate', icon: 'road' }, // road/street
  { id: 'architecture', label: 'Architecture', icon: 'building-o' },
  { id: 'interior_design', label: 'Décoration', icon: 'home' },
  { id: 'collecting', label: 'Collection', icon: 'archive' },
  { id: 'poker', label: 'Poker', icon: 'money' },
  { id: 'chess', label: 'Échecs', icon: 'trophy' }, // strategy/trophy
  { id: 'bowling', label: 'Bowling', icon: 'dot-circle-o' },
  { id: 'billiards', label: 'Billard', icon: 'circle' },
  { id: 'darts', label: 'Fléchettes', icon: 'bullseye' },
  { id: 'escape_games', label: 'Escape Games', icon: 'key' },
  { id: 'laser_tag', label: 'Laser Tag', icon: 'crosshairs' },
  { id: 'paintball', label: 'Paintball', icon: 'crosshairs' },
  { id: 'paragliding', label: 'Parapente', icon: 'cloud' },
  { id: 'skydiving', label: 'Parachutisme', icon: 'plane' },
  { id: 'scuba_diving', label: 'Plongée', icon: 'tint' },
  { id: 'sailing', label: 'Voile', icon: 'ship' },
  { id: 'rowing', label: 'Aviron', icon: 'ship' },
  { id: 'rugby', label: 'Rugby', icon: 'soccer-ball-o' }, // generic ball
  { id: 'volleyball', label: 'Volleyball', icon: 'soccer-ball-o' },
  { id: 'handball', label: 'Handball', icon: 'soccer-ball-o' },
  { id: 'badminton', label: 'Badminton', icon: 'circle-o' },
  { id: 'table_tennis', label: 'Ping-pong', icon: 'circle' },
  { id: 'squash', label: 'Squash', icon: 'circle' },
  { id: 'golf', label: 'Golf', icon: 'flag' },
  { id: 'horse_riding', label: 'Équitation', icon: 'heart' }, // often associated with love for animals
  { id: 'gymnastics', label: 'Gymnastique', icon: 'child' }, // body movement
  { id: 'athletics', label: 'Athlétisme', icon: 'road' },
  { id: 'triathlon', label: 'Triathlon', icon: 'trophy' },
  { id: 'crossfit', label: 'Crossfit', icon: 'anchor' },
];

// Helper pour avoir un mapping id -> label (utilisé dans les settings et le profil)
export const ACTIVITY_LABELS: Record<string, string> = {
    ...ACTIVITIES.reduce((acc, act) => {
        acc[act.id] = act.label;
        return acc;
    }, {} as Record<string, string>),
    // Legacy support (garder les anciens labels si nécessaire)
    amical: 'Amical',
    amoureux: 'Relation sérieuse',
    'sans prise de tête': 'Sans prise de tête',
};
