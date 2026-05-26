let currentPersonId = $state<string | null>(null);

export const identityStore = {
	get currentPersonId() {
		return currentPersonId;
	},
	setCurrentPerson(id: string) {
		currentPersonId = id;
	},
	clear() {
		currentPersonId = null;
	}
};
