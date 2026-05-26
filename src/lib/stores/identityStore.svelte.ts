let currentPersonId = $state<string | null>(null);
let tourActive = $state<boolean>(false);

export const identityStore = {
	get currentPersonId() {
		return currentPersonId;
	},
	get tourActive() {
		return tourActive;
	},
	setCurrentPerson(id: string) {
		currentPersonId = id;
	},
	setTourActive(v: boolean) {
		tourActive = v;
	},
	clear() {
		currentPersonId = null;
	}
};
