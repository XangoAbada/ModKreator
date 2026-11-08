package pl.modkreator.mod;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ModKreatorMod implements ModInitializer {
	public static final String MOD_ID = "modkreator_mod";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	@Override
	public void onInitialize() {
		// Tu ModKreator dopisuje nowe przedmioty, bloki i receptury.
		LOGGER.info("Mod z ModKreatora załadowany!");
	}
}
