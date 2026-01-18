# Split the Bill

A privacy-focused web app for splitting restaurant bills with friends. Scan or paste your receipt, assign items to people, and calculate who owes what - all processed locally in your browser.

## Features

- **Receipt Parsing** - Paste text from Google Lens or Apple Live Text, or use built-in OCR to scan receipt images
- **Smart Item Detection** - Automatically extracts items, prices, tax, and tip from receipt text
- **Quantity Support** - Handles items with quantities (e.g., "2x Burger $25.98")
- **Easy Assignment** - Tap to assign items to people, split items between multiple people
- **Real-time Sync** - Share a link to collaborate with friends in real-time using peer-to-peer connections
- **Passcode Protection** - Optionally protect shared sessions with a passcode
- **Automatic Calculations** - Proportionally splits tax and tip based on each person's items
- **Cash Back Support** - Factor in credit card cash back rewards

## Privacy

- All calculations, image processing, and OCR are done locally in your browser
- Real-time sync uses peer-to-peer (P2P) WebRTC connections - no data is stored on servers
- No accounts, no tracking, no data collection

## Tech Stack

- [SvelteKit](https://kit.svelte.dev/) with Svelte 5
- [Tailwind CSS](https://tailwindcss.com/) v4
- [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR
- [PeerJS](https://peerjs.com/) for P2P real-time sync

## Try It

**[https://atch2203.github.io/split-the-bill](https://atch2203.github.io/split-the-bill)**

## Usage

1. **Add Receipt** - Paste receipt text (from Google Lens or Live Text) or scan an image
2. **Add People** - Enter names of people splitting the bill
3. **Assign Items** - Tap on person badges to assign items to them
4. **Adjust Settings** - Set tax, tip percentage, and optional cash back
5. **View Summary** - See the breakdown of what each person owes

### Sharing with Friends

1. Click the **Share** button to start a session
2. Optionally set a passcode for the session
3. Share the link with friends
4. Everyone can assign items in real-time