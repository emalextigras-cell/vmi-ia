/** Fonctions centrales partagées par l'application. */
export const $ = id => document.getElementById(id);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const APP_VERSION = '13';
