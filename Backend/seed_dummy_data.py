"""
Seed script for QCF News / Celeb Scoop.
Populates 10+ realistic, high-quality celebrity, red carpet, style, movie, music, and TV stories for each category (60 total articles).
"""
import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, delete
from src.db.session import SessionLocal
from src.apps.v1.news.models.news import Category, Article, ArticleImage
from src.apps.v1.users.models.users import User

# Curated high-res imagery for articles & galleries
IMG_POOL = [
    "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1469334031218-e382a71b716b?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1445205170230-053b83016050?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1509631179647-0177331693ae?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1478720568477-152d9b164e26?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?q=80&w=1200&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1496337589254-7e19d01cec44?q=80&w=1200&auto=format&fit=crop",
]

CATEGORIES_DATA = [
    {"name": "Red Carpet", "slug": "red-carpet", "description": "Awards galas, premiere nights, and exclusive red carpet fashion."},
    {"name": "Movies", "slug": "movies", "description": "Box office hits, movie premieres, behind-the-scenes scoops, and trailers."},
    {"name": "Music", "slug": "music", "description": "Pop icons, world tours, album drops, and music industry news."},
    {"name": "Style", "slug": "style", "description": "Haute couture, street fashion, celebrity trends, and Met Gala breakdowns."},
    {"name": "Couples", "slug": "couples", "description": "A-list romances, secret getaways, celebrity dates, and relationship news."},
    {"name": "TV & Drama", "slug": "tv", "description": "Binge-worthy shows, finale recaps, streaming hits, and television gossip."},
]

# 10 articles per category = 60 articles total
RAW_ARTICLES = [
    # ── RED CARPET (10) ──────────────────────────────────────────────────────────
    {
        "cat": "red-carpet",
        "title": "Glitz, Glamour, and Surprises: Inside the Global Gala",
        "slug": "glitz-glamour-and-surprises-inside-the-global-gala",
        "summary": "From jaw-dropping red carpet looks to unexpected wins, we have the complete breakdown of everything that happened at Hollywood's biggest night of the year.",
        "is_featured": True, "hours_ago": 1,
        "img_idx": 0,
        "gallery": [0, 10, 2],
    },
    {
        "cat": "red-carpet",
        "title": "The Most Jaw-Dropping Looks from the Golden Gala Red Carpet",
        "slug": "the-most-jaw-dropping-looks-from-the-golden-gala-red-carpet",
        "summary": "From sheer elegance to bold vintage statements, see who stole the spotlight on the red carpet this year with unforgettable fashion moments.",
        "is_featured": False, "hours_ago": 3,
        "img_idx": 1,
        "gallery": [1, 3],
    },
    {
        "cat": "red-carpet",
        "title": "Venice Film Festival Arrivals: The Best Dressed Celebrities",
        "slug": "venice-film-festival-arrivals-the-best-dressed-celebrities",
        "summary": "Water taxis, crystal-embellished silk gowns, and tailored tuxedos took center stage as international stars arrived on Lido island.",
        "is_featured": False, "hours_ago": 7,
        "img_idx": 2,
        "gallery": [2, 11],
    },
    {
        "cat": "red-carpet",
        "title": "Oscars After-Party Secrets: What Really Happened Behind Closed Doors",
        "slug": "oscars-after-party-secrets-what-really-happened",
        "summary": "Inside the exclusive Vanity Fair bash where winners danced until dawn and fashion changes wowed attendees.",
        "is_featured": False, "hours_ago": 12,
        "img_idx": 10,
    },
    {
        "cat": "red-carpet",
        "title": "Cannes Red Carpet Glamour: Diamonds, Tulle, and High Drama",
        "slug": "cannes-red-carpet-glamour-diamonds-tulle-high-drama",
        "summary": "A-listers graced the famous steps of the Palais des Festivals in archival gowns and million-dollar diamond necklaces.",
        "is_featured": False, "hours_ago": 18,
        "img_idx": 11,
        "gallery": [11, 0],
    },
    {
        "cat": "red-carpet",
        "title": "Grammy Red Carpet Evolution: 10 Iconic Outfits That Defined Eras",
        "slug": "grammy-red-carpet-evolution-10-iconic-outfits",
        "summary": "Looking back at the most daring, outrageous, and legendary music awards red carpet statements in history.",
        "is_featured": False, "hours_ago": 26,
        "img_idx": 6,
    },
    {
        "cat": "red-carpet",
        "title": "BAFTA Gala Highlights: Royalty Meets Hollywood Royalty",
        "slug": "bafta-gala-highlights-royalty-meets-hollywood-royalty",
        "summary": "London's Royal Festival Hall shone brightly as international film stars joined British royalty for a memorable evening.",
        "is_featured": False, "hours_ago": 32,
        "img_idx": 10,
    },
    {
        "cat": "red-carpet",
        "title": "SAG Awards Glamour: Bold Color Palettes and Custom Tailoring",
        "slug": "sag-awards-glamour-bold-color-palettes-and-custom-tailoring",
        "summary": "Actors celebrated actors in eye-catching neon tones, sleek velvet tuxedos, and architectural silhouettes.",
        "is_featured": False, "hours_ago": 40,
        "img_idx": 1,
        "gallery": [1, 2],
    },
    {
        "cat": "red-carpet",
        "title": "Emmy Awards Red Carpet: The Night's Most Unforgettable Jewelry",
        "slug": "emmy-awards-red-carpet-unforgettable-jewelry",
        "summary": "From 50-carat sapphire brooches to vintage Cartier chokers, jewelry took front and center stage.",
        "is_featured": False, "hours_ago": 48,
        "img_idx": 9,
    },
    {
        "cat": "red-carpet",
        "title": "Exclusive Look at the Met Gala After-Party Fashion",
        "slug": "exclusive-look-at-the-met-gala-after-party-fashion",
        "summary": "When the main museum steps close, stars slip into party-ready mini dresses and latex boots for night celebrations.",
        "is_featured": False, "hours_ago": 56,
        "img_idx": 3,
        "gallery": [3, 14],
    },

    # ── MOVIES (10) ─────────────────────────────────────────────────────────────
    {
        "cat": "movies",
        "title": "Sci-Fi Epic Premiere Draws Massive Crowds in London",
        "slug": "sci-fi-epic-premiere-draws-massive-crowds-in-london",
        "summary": "The star-studded cast greeted thousands of roaring fans at Leicester Square for the European debut of the year's most anticipated film.",
        "is_featured": False, "hours_ago": 5,
        "img_idx": 4,
        "gallery": [4],
    },
    {
        "cat": "movies",
        "title": "Behind the Scenes Drama on Set of Upcoming Summer Blockbuster",
        "slug": "behind-the-scenes-drama-on-set-of-upcoming-summer-blockbuster",
        "summary": "Insiders reveal script rewrites, delayed shooting schedules, and intense stunt work on location in Iceland.",
        "is_featured": False, "hours_ago": 12,
        "img_idx": 12,
    },
    {
        "cat": "movies",
        "title": "Action Franchise Lead Performs Jaw-Dropping 100-Foot Stunt",
        "slug": "action-franchise-lead-performs-jaw-dropping-stunt",
        "summary": "Refusing a stunt double, the lead actor leapt from a moving helicopter in a high-octane scene caught on camera.",
        "is_featured": False, "hours_ago": 15,
        "img_idx": 4,
        "gallery": [4, 12],
    },
    {
        "cat": "movies",
        "title": "Indie Film Takes Sundance by Storm and Secures $20M Deal",
        "slug": "indie-film-takes-sundance-by-storm-secures-deal",
        "summary": "A heartwarming coming-of-age drama received tears, a standing ovation, and a record-setting distribution bid.",
        "is_featured": False, "hours_ago": 22,
        "img_idx": 12,
    },
    {
        "cat": "movies",
        "title": "Box Office Breakdown: Superhero Sequel Crushes Global Records",
        "slug": "box-office-breakdown-superhero-sequel-crushes-records",
        "summary": "Opening to $350 million worldwide, the blockbuster installment shattered previous IMAX and preview night milestones.",
        "is_featured": False, "hours_ago": 29,
        "img_idx": 4,
    },
    {
        "cat": "movies",
        "title": "Director Cut Confirmed for Cult Favorite Sci-Fi Masterpiece",
        "slug": "director-cut-confirmed-for-cult-favorite-sci-fi-masterpiece",
        "summary": "Featuring 45 minutes of unseen footage and an alternate ending, the remastered edition hits theaters this fall.",
        "is_featured": False, "hours_ago": 36,
        "img_idx": 12,
    },
    {
        "cat": "movies",
        "title": "First Look Photo Released for High-Stakes Spy Thriller Reboot",
        "slug": "first-look-photo-released-for-spy-thriller-reboot",
        "summary": "The teaser photo shows the new secret agent suited up on location in Prague, sparking intense fan speculation.",
        "is_featured": False, "hours_ago": 44,
        "img_idx": 4,
        "gallery": [4, 13],
    },
    {
        "cat": "movies",
        "title": "Oscar Contender Receives 12-Minute Standing Ovation in Venice",
        "slug": "oscar-contender-receives-12-minute-standing-ovation",
        "summary": "Critically acclaimed lead performance left festival audiences in tears as the lights came up in the theater.",
        "is_featured": False, "hours_ago": 52,
        "img_idx": 2,
    },
    {
        "cat": "movies",
        "title": "Animated Family Hit Crosses $1 Billion Milestone Worldwide",
        "slug": "animated-family-hit-crosses-1-billion-milestone",
        "summary": "Becoming only the third animated film this decade to hit ten figures, studios have officially announced a sequel.",
        "is_featured": False, "hours_ago": 61,
        "img_idx": 12,
    },
    {
        "cat": "movies",
        "title": "Veteran Actor Confirms Farewell Role in Emotional Final Chapter",
        "slug": "veteran-actor-confirms-farewell-role-in-final-chapter",
        "summary": "After five decades in Hollywood, the Oscar winner reflects on their legendary career ahead of their final film.",
        "is_featured": False, "hours_ago": 70,
        "img_idx": 4,
    },

    # ── MUSIC (10) ──────────────────────────────────────────────────────────────
    {
        "cat": "music",
        "title": "Pop Icon Drops Surprise Midnight Album & Breaks Records",
        "slug": "pop-icon-drops-surprise-midnight-album-breaks-records",
        "summary": "With zero prior announcement, the 14-track project achieved over 100 million streams in its first twelve hours online.",
        "is_featured": False, "hours_ago": 4,
        "img_idx": 5,
        "gallery": [5, 6],
    },
    {
        "cat": "music",
        "title": "World Tour Sells Out Stadiums Nationwide in Under Five Minutes",
        "slug": "world-tour-sells-out-stadiums-nationwide-in-under-five-minutes",
        "summary": "Over 3 million fans joined online ticket queues as extra stadium dates were instantly added to meet unprecedented demand.",
        "is_featured": False, "hours_ago": 18,
        "img_idx": 6,
    },
    {
        "cat": "music",
        "title": "Headline Festival Performance Features Unannounced Guest Duet",
        "slug": "headline-festival-performance-features-unannounced-guest-duet",
        "summary": "80,000 festivalgoers erupted as two global superstars shared the main stage for an unforgettable encore song.",
        "is_featured": False, "hours_ago": 21,
        "img_idx": 5,
        "gallery": [5, 6, 13],
    },
    {
        "cat": "music",
        "title": "Grammy Nominations Released: Here Are the Snubs and Surprises",
        "slug": "grammy-nominations-released-snubs-and-surprises",
        "summary": "A-list artists react to leading album of the year nominations while several fan favorites were left off the ballot.",
        "is_featured": False, "hours_ago": 27,
        "img_idx": 13,
    },
    {
        "cat": "music",
        "title": "R&B Legend Announces Reunion Tour After 15-Year Hiatus",
        "slug": "r-and-b-legend-announces-reunion-tour-after-15-year-hiatus",
        "summary": "Original band members reconcile and announce a 30-city arena tour kicking off early next spring.",
        "is_featured": False, "hours_ago": 34,
        "img_idx": 6,
    },
    {
        "cat": "music",
        "title": "Chart-Topping Single Crosses 2 Billion Streams Globally",
        "slug": "chart-topping-single-crosses-2-billion-streams",
        "summary": "The summer anthem continues its historic run on top of the global charts for the 16th consecutive week.",
        "is_featured": False, "hours_ago": 42,
        "img_idx": 5,
    },
    {
        "cat": "music",
        "title": "Behind the Scenes of the Year's Most Expensive Music Video",
        "slug": "behind-the-scenes-most-expensive-music-video",
        "summary": "Featuring CGI dragons, custom haute couture, and a 100-person dance crew on location in Tokyo.",
        "is_featured": False, "hours_ago": 51,
        "img_idx": 13,
        "gallery": [13, 6],
    },
    {
        "cat": "music",
        "title": "Indie Rock Band Sells Out Historic Arena Three Nights in a Row",
        "slug": "indie-rock-band-sells-out-historic-arena-three-nights",
        "summary": "From playing basement gigs five years ago to selling out 20,000-seat arenas, see the band's remarkable rise.",
        "is_featured": False, "hours_ago": 60,
        "img_idx": 6,
    },
    {
        "cat": "music",
        "title": "Electronic Music Festival Sets Attendance Record with 200k Fans",
        "slug": "electronic-music-festival-sets-attendance-record",
        "summary": "Dazzling laser shows, pyrotechnics, and 72 non-stop hours of music lit up the desert skyline.",
        "is_featured": False, "hours_ago": 68,
        "img_idx": 5,
    },
    {
        "cat": "music",
        "title": "Breakout Artist Wins Best New Artist at International Music Awards",
        "slug": "breakout-artist-wins-best-new-artist-at-international-awards",
        "summary": "The 19-year-old singer-songwriter delivered a tearful speech after taking home three major awards.",
        "is_featured": False, "hours_ago": 77,
        "img_idx": 13,
    },

    # ── STYLE (10) ──────────────────────────────────────────────────────────────
    {
        "cat": "style",
        "title": "Met Gala Vintage Couture: Who Nailed the Theme and Who Missed",
        "slug": "met-gala-vintage-couture-who-nailed-the-theme",
        "summary": "Archival gowns and custom crystal embroideries took over the museum steps. We rank the top looks of the evening.",
        "is_featured": False, "hours_ago": 6,
        "img_idx": 3,
        "gallery": [3, 11, 9],
    },
    {
        "cat": "style",
        "title": "Paris Fashion Week: The Celebrities Who Stole the Front Row",
        "slug": "paris-fashion-week-the-celebrities-who-stole-the-front-row",
        "summary": "From oversized tailored blazers to avant-garde headpieces, A-listers brought runway drama to the front row.",
        "is_featured": False, "hours_ago": 14,
        "img_idx": 11,
        "gallery": [11, 9],
    },
    {
        "cat": "style",
        "title": "Milan Fashion Week: Leather, Lace, and Structural Tailoring",
        "slug": "milan-fashion-week-leather-lace-and-structural-tailoring",
        "summary": "Italian luxury houses debuted bold monochrome aesthetics and dramatic trench coats for the upcoming season.",
        "is_featured": False, "hours_ago": 20,
        "img_idx": 9,
        "gallery": [9, 14],
    },
    {
        "cat": "style",
        "title": "Celebrity Street Style Trends Taking Over Social Media This Season",
        "slug": "celebrity-street-style-trends-taking-over-social-media",
        "summary": "Baggy denim, vintage leather jackets, and chunky retro sneakers dominate off-duty model street fashion.",
        "is_featured": False, "hours_ago": 25,
        "img_idx": 14,
    },
    {
        "cat": "style",
        "title": "Inside the Wardrobe of Hollywood's Top Celebrity Stylist",
        "slug": "inside-the-wardrobe-of-hollywoods-top-celebrity-stylist",
        "summary": "An exclusive look at the rack rooms where red carpet outfits are curated, fitted, and styled for A-listers.",
        "is_featured": False, "hours_ago": 33,
        "img_idx": 3,
    },
    {
        "cat": "style",
        "title": "Sustainable Fashion Revolution: Stars Wearing Recycled Gowns",
        "slug": "sustainable-fashion-revolution-stars-wearing-recycled-gowns",
        "summary": "Celebrities are championing eco-friendly fashion by re-wearing archival pieces and opting for zero-waste fabrics.",
        "is_featured": False, "hours_ago": 41,
        "img_idx": 15,
    },
    {
        "cat": "style",
        "title": "Fall Trench Coat Trends Inspired by A-List Celebrities",
        "slug": "fall-trench-coat-trends-inspired-by-a-list-celebrities",
        "summary": "Floor-length leather, classic camel wool, and patent vinyl trenches are autumn's must-have outerwear statement.",
        "is_featured": False, "hours_ago": 49,
        "img_idx": 9,
    },
    {
        "cat": "style",
        "title": "The High Jewelry Collection Everyone is Talking About",
        "slug": "the-high-jewelry-collection-everyone-is-talking-about",
        "summary": "Rare pink diamonds, emerald drop earrings, and snake-shaped platinum cuffs made their debut at Place Vendôme.",
        "is_featured": False, "hours_ago": 58,
        "img_idx": 9,
        "gallery": [9, 3],
    },
    {
        "cat": "style",
        "title": "Men's Tailoring Reimagined: Bold Suits on the Red Carpet",
        "slug": "mens-tailoring-reimagined-bold-suits-on-red-carpet",
        "summary": "Ditching traditional black tuxedos, male stars are embracing pastel silk suits, pearl brooches, and sheer shirts.",
        "is_featured": False, "hours_ago": 66,
        "img_idx": 15,
    },
    {
        "cat": "style",
        "title": "90s Minimalism Makes a Major Comeback on the Runway",
        "slug": "90s-minimalism-makes-a-major-comeback-on-the-runway",
        "summary": "Slip dresses, muted earth tones, and clean lines dominate contemporary collections across New York and Paris.",
        "is_featured": False, "hours_ago": 74,
        "img_idx": 14,
        "gallery": [14, 15],
    },

    # ── COUPLES (10) ─────────────────────────────────────────────────────────────
    {
        "cat": "couples",
        "title": "A-List Pair Spotted on Romantic Getaway in Amalfi Coast",
        "slug": "a-list-pair-spotted-on-romantic-getaway-in-amalfi-coast",
        "summary": "Rumors were finally confirmed as the Hollywood power couple enjoyed a private yacht vacation following their blockbuster premiere.",
        "is_featured": False, "hours_ago": 2,
        "img_idx": 7,
        "gallery": [7],
    },
    {
        "cat": "couples",
        "title": "Power Couple Makes First Joint Red Carpet Appearance in Paris",
        "slug": "power-couple-makes-first-joint-red-carpet-appearance-in-paris",
        "summary": "Hand in hand in matching custom velvet, the duo turned heads at the annual charity gala.",
        "is_featured": False, "hours_ago": 20,
        "img_idx": 9,
    },
    {
        "cat": "couples",
        "title": "Secret Wedding Details Revealed: Intimate Ceremony in Tuscany",
        "slug": "secret-wedding-details-revealed-intimate-ceremony-in-tuscany",
        "summary": "Surrounded by 40 close family members and friends, the couple exchanged vows under a sunset olive grove.",
        "is_featured": False, "hours_ago": 28,
        "img_idx": 16,
        "gallery": [16, 7],
    },
    {
        "cat": "couples",
        "title": "Celebrity Duo Spotted Holding Hands at Private Dinner in NYC",
        "slug": "celebrity-duo-spotted-holding-hands-at-private-dinner-nyc",
        "summary": "Leaving a West Village hotspot late Thursday night, the newly matched pair appeared smiling and laughing.",
        "is_featured": False, "hours_ago": 35,
        "img_idx": 16,
    },
    {
        "cat": "couples",
        "title": "Inside the Multi-Million Dollar Mansion Purchased by Power Couple",
        "slug": "inside-the-multi-million-dollar-mansion-purchased-by-power-couple",
        "summary": "The 12,000-square-foot Beverly Hills estate features an infinity pool, tennis court, and private screening room.",
        "is_featured": False, "hours_ago": 43,
        "img_idx": 7,
    },
    {
        "cat": "couples",
        "title": "A-List Couple Celebrates 10-Year Anniversary with Maldives Trip",
        "slug": "a-list-couple-celebrates-10-year-anniversary-with-maldives-trip",
        "summary": "Sharing rare personal photos from their overwater bungalow, the couple celebrated ten years of marriage.",
        "is_featured": False, "hours_ago": 50,
        "img_idx": 7,
        "gallery": [7, 16],
    },
    {
        "cat": "couples",
        "title": "Unexpected Romance: Co-Stars Sparks Fly Off Screen",
        "slug": "unexpected-romance-co-stars-sparks-fly-off-screen",
        "summary": "Their onscreen chemistry was undeniable, and now sources confirm the two lead actors are officially dating.",
        "is_featured": False, "hours_ago": 59,
        "img_idx": 16,
    },
    {
        "cat": "couples",
        "title": "Hollywood Royalty Pair Up for High-Profile Charity Gala",
        "slug": "hollywood-royalty-pair-up-for-high-profile-charity-gala",
        "summary": "Co-hosting the gala together, the couple helped raise over $15 million for children's healthcare education.",
        "is_featured": False, "hours_ago": 67,
        "img_idx": 9,
    },
    {
        "cat": "couples",
        "title": "Star Couple Spotted Enjoying Front-Row Seats at NBA Finals",
        "slug": "star-couple-spotted-enjoying-front-row-seats-at-nba-finals",
        "summary": "Dressed in matching leather jackets, the pair cheered from courtside seats alongside fellow celebrity fans.",
        "is_featured": False, "hours_ago": 75,
        "img_idx": 16,
    },
    {
        "cat": "couples",
        "title": "Intimate Engagement Party Photos Shared by Pop Superstar Couple",
        "slug": "intimate-engagement-party-photos-shared-by-pop-superstar-couple",
        "summary": "Featuring candlelit garden tables and acoustic serenades, photos from the private party blew up on Instagram.",
        "is_featured": False, "hours_ago": 82,
        "img_idx": 7,
        "gallery": [7, 16],
    },

    # ── TV & DRAMA (10) ──────────────────────────────────────────────────────────
    {
        "cat": "tv",
        "title": "Shocking Finale Leaves Fans Demanding Answers for Season 2",
        "slug": "shocking-finale-leaves-fans-demanding-answers-for-season-2",
        "summary": "The cliffhanger ending of the hit mystery thriller had social media exploding. Here is our breakdown of all unanswered clues.",
        "is_featured": False, "hours_ago": 8,
        "img_idx": 8,
    },
    {
        "cat": "tv",
        "title": "Streaming Giant Renews Fan-Favorite Fantasy Series for 2 Seasons",
        "slug": "streaming-giant-renews-fan-favorite-fantasy-series-for-2-seasons",
        "summary": "Following record-breaking viewership numbers globally, production on season three will begin next month.",
        "is_featured": False, "hours_ago": 24,
        "img_idx": 8,
    },
    {
        "cat": "tv",
        "title": "Record-Breaking Audience Turns Out for Historic Series Finale",
        "slug": "record-breaking-audience-turns-out-for-historic-series-finale",
        "summary": "After six critically acclaimed seasons, over 18 million viewers tuned in live to say goodbye to the iconic drama.",
        "is_featured": False, "hours_ago": 30,
        "img_idx": 17,
        "gallery": [17, 8],
    },
    {
        "cat": "tv",
        "title": "True Crime Docuseries Reaches #1 Spot Worldwide within 24 Hours",
        "slug": "true-crime-docuseries-reaches-1-spot-worldwide",
        "summary": "The gripping 4-part investigative series has captivated subscribers with never-before-seen archival tapes.",
        "is_featured": False, "hours_ago": 37,
        "img_idx": 8,
    },
    {
        "cat": "tv",
        "title": "Behind the Scenes of the Most Expensive Television Episode Ever",
        "slug": "behind-the-scenes-most-expensive-television-episode",
        "summary": "With a budget of $25 million for a single battle episode, directors built an entire medieval town set on location.",
        "is_featured": False, "hours_ago": 45,
        "img_idx": 17,
        "gallery": [17],
    },
    {
        "cat": "tv",
        "title": "Emmy Winner Joins Cast of Hit Medical Drama for Season 5",
        "slug": "emmy-winner-joins-cast-of-hit-medical-drama",
        "summary": "Taking on the role of chief of surgery, the acclaimed actor promises to shake up existing hospital relationships.",
        "is_featured": False, "hours_ago": 53,
        "img_idx": 8,
    },
    {
        "cat": "tv",
        "title": "Teaser Trailer Released for Highly Anticipated Mystery Prequel",
        "slug": "teaser-trailer-released-for-mystery-prequel",
        "summary": "The 60-second clip gives fans their first look at the origins of the sinister secret society that started it all.",
        "is_featured": False, "hours_ago": 62,
        "img_idx": 17,
    },
    {
        "cat": "tv",
        "title": "Reality TV Reunion Episode Sparks Heated On-Air Confrontations",
        "slug": "reality-tv-reunion-episode-sparks-heated-confrontations",
        "summary": "Unresolved tension boiled over on set as cast members confronted each other over rumors spread throughout the season.",
        "is_featured": False, "hours_ago": 71,
        "img_idx": 8,
    },
    {
        "cat": "tv",
        "title": "Binge-Worthy Thriller Top-Rated Show of the Season on Rotten Tomatoes",
        "slug": "binge-worthy-thriller-top-rated-show-of-season",
        "summary": "Boasting a 98% critic score, the psychological suspense series has become a word-of-mouth runaway success.",
        "is_featured": False, "hours_ago": 79,
        "img_idx": 17,
    },
    {
        "cat": "tv",
        "title": "Showrunner Teases Unexpected Character Returns for Season 4",
        "slug": "showrunner-teases-unexpected-character-returns-for-season-4",
        "summary": "Thought to have left the show for good, fan-favorite actors have been spotted filming scenes on location in Vancouver.",
        "is_featured": False, "hours_ago": 88,
        "img_idx": 8,
        "gallery": [8, 17],
    },
]

def generate_article_content(title, category_name):
    return f"""<p>The lights were blinding, the atmosphere electric, and the news sent shockwaves across the industry. As events unfolded in <strong>{title}</strong>, fans and critics around the world tuned in to witness history in the making.</p>
<blockquote class="quote">"We wanted to deliver a moment that felt timeless, authentic, and completely unforgettable. Today was about celebrating excellence in {category_name.lower()}."</blockquote>
<p>Leading up to this point, industry insiders had speculated for weeks about potential developments. Beyond the initial excitement, the outcome delivered emotional reactions, record engagement, and instant viral trends across social media platforms.</p>
<h3>Inside the Exclusive Details</h3>
<p>Draped in high style and surrounded by top talents, the atmosphere was unmatched. Critics quickly noted how this moment marks a major turning point in modern {category_name.lower()} culture, establishing new benchmarks for seasons to come.</p>
<p>With official announcements now confirmed, fans can expect even more surprises as additional updates roll out over the coming weeks.</p>"""

async def seed():
    async with SessionLocal() as session:
        # Fetch author user
        author = (await session.execute(select(User))).scalars().first()
        if not author:
            print("❌ No user found. Creating admin user first...")
            return

        print(f"👤 Author found: {author.first_name} {author.last_name} (ID: {author.id})")

        # 1. Upsert Categories
        category_map = {}
        for cat_info in CATEGORIES_DATA:
            stmt = select(Category).where(Category.slug == cat_info["slug"])
            cat = (await session.execute(stmt)).scalars().first()
            if not cat:
                cat = Category(
                    name=cat_info["name"],
                    slug=cat_info["slug"],
                    description=cat_info["description"],
                    is_active=True,
                )
                session.add(cat)
                await session.flush()
                print(f"✅ Created Category: {cat.name}")
            else:
                cat.name = cat_info["name"]
                cat.description = cat_info["description"]
                cat.is_active = True
                print(f"🔄 Updated Category: {cat.name}")
            category_map[cat.slug] = (cat.id, cat.name)

        # 2. Hard delete existing articles and images to allow clean re-seeding
        await session.execute(delete(ArticleImage))
        await session.execute(delete(Article))
        await session.flush()
        print("🧹 Cleared old articles and images.")

        # 3. Create Articles & Images
        now = datetime.now(timezone.utc)

        for art_data in RAW_ARTICLES:
            cat_id, cat_name = category_map[art_data["cat"]]
            created_time = now - timedelta(hours=art_data.get("hours_ago", 1))
            cover_img = IMG_POOL[art_data["img_idx"] % len(IMG_POOL)]
            content_html = generate_article_content(art_data["title"], cat_name)

            article = Article(
                title=art_data["title"],
                slug=art_data["slug"],
                summary=art_data["summary"],
                content=content_html,
                cover_image_url=cover_img,
                is_published=True,
                is_featured=art_data.get("is_featured", False),
                category_id=cat_id,
                author_id=author.id,
                created_at=created_time,
                updated_at=created_time,
            )
            session.add(article)
            await session.flush()

            # Add gallery images if present
            if "gallery" in art_data:
                for order, idx in enumerate(art_data["gallery"]):
                    img_url = IMG_POOL[idx % len(IMG_POOL)]
                    img = ArticleImage(
                        article_id=article.id,
                        image_url=img_url,
                        caption=f"Gallery photo #{order + 1} for {art_data['title']}",
                        alt_text=art_data["title"],
                        sort_order=order,
                    )
                    session.add(img)

        await session.commit()
        print(f"🎉 Database successfully seeded with {len(RAW_ARTICLES)} articles (10 per category)!")

if __name__ == "__main__":
    asyncio.run(seed())
