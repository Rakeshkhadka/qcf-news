type Story = {
  title: string;
  summary: string;
  image: string;
};

type HotStory = {
  category: string;
  title: string;
  time: string;
};

type CategoryStory = {
  name: string;
  title: string;
  href: string;
  time?: string;
  image?: string;
  gallery?: boolean;
  treatment?: string;
};

type TrendingStory = { title: string; category: string };

type ArticleImage = {
  url: string;
  caption?: string;
  alt?: string;
};

type Article = {
  title: string;
  subtitle: string;
  /** Cover image — also the first slide of the carousel. */
  image: string;
  /** Gallery shown as a carousel in place of the single main image. */
  images: ArticleImage[];
  paragraphs: string[];
};

const image = {
  gala: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1000&q=85',
  film: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=85',
  concert: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=85',
  couple: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=85',
  carpet: 'https://images.unsplash.com/photo-1542296332-2e4473faf563?auto=format&fit=crop&w=1300&q=85',
  fashion: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=85',
  gown: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1400&q=85',
};

export const heroStory: Story = { title: 'Glitz, Glamour, and Surprises: Inside the Global Awards Gala', summary: "From jaw-dropping red carpet looks to unexpected wins, we have the complete breakdown of everything that happened at Hollywood's biggest night of the year.", image: image.gala };
export const hotStories: HotStory[] = [
  { category: 'Couples', title: 'A-List Pair Spotted on Romantic Getaway in Italy', time: '30 mins ago' },
  { category: 'Fashion', title: 'The Return of Vintage Couture on the Runway', time: '2 hours ago' },
  { category: 'Music', title: 'Pop Icon Drops Surprise Album at Midnight', time: '4 hours ago' },
  { category: 'Movies', title: 'Highly Anticipated Sequel Breaks Box Office Records', time: '6 hours ago' },
  { category: 'TV', title: 'Shocking Finale Leaves Fans Demanding Answers', time: '9 hours ago' },
];
export const categories: CategoryStory[] = [
  { name: 'Movies', title: 'Sci-Fi Epic Premiere Draws Massive Crowds in London', time: '1 hr ago', image: image.film, href: '/feed' },
  { name: 'Style', title: 'Met Gala Looks: Who Nailed the Theme and Who Missed the Mark', gallery: true, href: '/article', treatment: 'text-card' },
  { name: 'Music', title: 'World Tour Sells Out in Minutes', time: '10 hrs ago', image: image.concert, href: '/red-carpet' },
];
export const feedStory: Story = { title: "Hollywood's Hottest Couple Makes Red Carpet Debut", summary: 'Rumors were finally put to rest as the star-studded premiere was completely overshadowed by their debut appearance.', image: image.couple };
export const trending: TrendingStory[] = [
  { title: 'Behind the Scenes Drama on Set of Upcoming Blockbuster', category: 'Movies' },
  { title: 'Pop Sensation Teases Surprise Midnight Album Drop', category: 'Music' },
  { title: 'Palace Insiders Reveal Tension Over State Dinner', category: 'Royals' },
];
export const popular: TrendingStory[] = [
  { title: 'The Met Gala’s Most Searched-For Beauty Moments', category: 'Style' },
  { title: 'A First Look at This Summer’s Biggest Blockbuster', category: 'Film' },
  { title: 'The Songs Everyone Is Adding to Their Weekend Playlist', category: 'Music' },
];
export const latest: TrendingStory[] = [
  { title: 'The New Comedy Series Already Winning Over Critics', category: 'TV' },
  { title: 'Inside the Intimate Dinner That Brought Hollywood Together', category: 'Culture' },
  { title: 'Award-Winning Director Announces a New Project', category: 'Movies' },
];
export const redCarpetStories: Story[] = [
  { title: 'The Most Jaw-Dropping Looks from the Golden Globes', summary: 'From sheer elegance to bold statements, see who stole the spotlight on the red carpet this year with unforgettable fashion moments.', image: image.carpet },
  { title: 'Paris Fashion Week: The Celebrities Who Stole the Front Row', summary: 'A-listers flocked to Paris to witness the latest haute couture collections.', image: image.fashion },
  { title: 'The New Rules of Awards-Season Dressing', summary: 'Stylists are rewriting the playbook with a new kind of cinematic glamour.', image: image.gala },
  { title: 'Inside Fashion’s Most Talked-About After-Party', summary: 'A quiet evening in the city became the event everyone wanted to attend.', image: image.couple },
  { title: 'Why Vintage Has Never Felt More Modern', summary: 'A new generation of stars is setting the red carpet alight with archive finds.', image: image.gown },
];
export const article: Article = { title: "Red Carpet Secrets: The Untold Story of the Year's Most Iconic Gown", subtitle: 'Behind the seams of the dress that broke the internet, featuring exclusive interviews with the designer and the star who brought it to life.', image: image.gown, images: [
  { url: image.gown, caption: 'Photo: Getty Images / Fashion Week Weekly', alt: 'The ornate crystal gown on the red carpet' },
  { url: image.carpet, caption: 'Arrivals began just after sunset. Photo: Getty Images', alt: 'Photographers lining the red carpet at dusk' },
  { url: image.fashion, caption: 'A detail of the hand-sewn bodice. Photo: Atelier Milano', alt: 'Close-up of the hand-sewn crystal bodice' },
  { url: image.gala, caption: 'The gown under the gala lights. Photo: Getty Images', alt: 'The gown photographed under the gala lights' },
], paragraphs: ["The moment she stepped out of the black SUV, the collective gasp from the press pit was audible. It wasn't just a dress; it was an architectural marvel wrapped in silk and hand-sewn crystals.", 'Designed by an elusive atelier based in Milan, the gown took over 800 hours to construct. The process was shrouded in secrecy, with NDAs signed by everyone from the seamstresses to the delivery drivers.', "What the cameras didn't capture was the intricate internal corsetry required to support the weight of the embellishments. The gown weighed nearly 30 pounds, primarily due to the dense concentration of crystals."] };
